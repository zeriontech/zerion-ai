import { encodeFunctionData, parseAbi, parseEther, parseUnits, formatEther, formatUnits } from "viem";
import { resolveToken } from "../../utils/trading/resolve-token.js";
import { requireAgentToken, parseTimeout, handleTradingError, enforceExecutablePolicies } from "../../utils/trading/guards.js";
import * as api from "../../utils/api/client.js";
import { getPublicClient, broadcastAndWait, signAndSerialize } from "../../utils/trading/transaction.js";
import { resolveWallet } from "../../utils/wallet/resolve.js";
import { print, printError } from "../../utils/common/output.js";
import { getConfigValue } from "../../utils/config.js";
import { getEvmAddress } from "../../utils/wallet/keystore.js";
import { NATIVE_ASSET_ADDRESS } from "../../utils/common/constants.js";
import { formatSwapQuote } from "../../utils/common/format.js";
import { validateChain } from "../../utils/common/validate.js";

const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export default async function send(args, flags) {
  const [token, amount] = args;
  const to = flags.to;

  if (!token || !amount) {
    printError("missing_args", "Usage: zerion send <token> <amount> --to <address> --chain <chain>", {
      example: "zerion send ETH 0.01 --to 0x... --chain base",
    });
    process.exit(1);
  }

  if (!to) {
    printError("missing_to", "Recipient address required (--to)", {
      example: `zerion send ${token} ${amount} --to 0x...`,
    });
    process.exit(1);
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
    printError("invalid_address", `Invalid recipient address: ${to}`, {
      suggestion: "Provide a valid 0x-prefixed EVM address (42 hex characters)",
    });
    process.exit(1);
  }

  const chainErr = validateChain(flags.chain);
  if (chainErr) {
    printError(chainErr.code, chainErr.message, { supportedChains: chainErr.supportedChains });
    process.exit(1);
  }

  const { walletName, address } = resolveWallet(flags);
  const chain = flags.chain || getConfigValue("defaultChain") || "ethereum";

  try {
    // Resolve token to get decimals and on-chain address
    const resolved = await resolveToken(token, chain);
    const isNative = resolved.address === NATIVE_ASSET_ADDRESS;

    // For ERC-20s: resolve chain-specific contract address if not already known
    if (!isNative && !resolved.address) {
      const fungible = await api.getFungible(resolved.fungibleId);
      const impl = fungible?.data?.attributes?.implementations?.find(
        (i) => i.chain_id === chain
      );
      if (impl?.address) {
        resolved.address = impl.address;
        if (impl.decimals != null) resolved.decimals = impl.decimals;
      }
    }

    // Compute amount in smallest units
    const amountParsed = isNative
      ? parseEther(amount)
      : parseUnits(amount, resolved.decimals);

    const summary = {
      send: {
        token: resolved.symbol,
        amount,
        from: address,
        to,
        chain,
        type: isNative ? "native" : "erc20",
      },
    };

    // Agent token required — no interactive passphrase for trading
    const passphrase = await requireAgentToken("for trading", walletName);

    const client = getPublicClient(chain);
    const walletAddress = getEvmAddress(walletName);

    const [nonce, feeData] = await Promise.all([
      client.getTransactionCount({ address: walletAddress, blockTag: "pending" }),
      client.estimateFeesPerGas(),
    ]);

    // Balance check: prevent broadcasting doomed transactions (include gas cost for native)
    const balance = await client.getBalance({ address: walletAddress });
    const estimatedGasCost = 21000n * (feeData.maxFeePerGas || 0n);
    if (isNative && balance < amountParsed + estimatedGasCost) {
      printError("insufficient_balance",
        `Insufficient ${resolved.symbol}: have ${formatEther(balance)}, need ${amount} + gas (~${formatEther(estimatedGasCost)})`,
        { suggestion: `Check balance: zerion portfolio --chain ${chain}` }
      );
      process.exit(1);
    }

    const baseTx = {
      type: "eip1559",
      chainId: client.chain.id,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      nonce,
    };

    const BALANCE_OF_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

    let tx;
    if (isNative) {
      tx = { ...baseTx, to, value: amountParsed, data: "0x", gas: 21000n };
    } else {
      const tokenAddress = resolved.address;
      if (!tokenAddress) {
        printError("no_contract", `Cannot resolve ERC-20 contract for ${resolved.symbol} on ${chain}`, {
          suggestion: `Try using the contract address directly: zerion send 0x... ${amount} --to ${to}`,
        });
        process.exit(1);
      }

      // ERC-20 balance check before broadcast
      try {
        const tokenBalance = await client.readContract({
          address: tokenAddress,
          abi: BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [walletAddress],
        });
        if (tokenBalance < amountParsed) {
          printError("insufficient_balance",
            `Insufficient ${resolved.symbol}: have ${formatUnits(tokenBalance, resolved.decimals)}, need ${amount}`,
            { suggestion: `Check balance: zerion positions --chain ${chain}` }
          );
          process.exit(1);
        }
      } catch {
        // If balanceOf fails (non-standard token), proceed and let gas estimation catch it
      }

      const data = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [to, amountParsed],
      });

      const gas = await estimateGasWithFallback(client, walletAddress, tokenAddress, data, 65000n);
      tx = { ...baseTx, to: tokenAddress, value: 0n, data, gas };
    }

    await enforceExecutablePolicies({ to: tx.to, value: tx.value, data: tx.data });
    const signedTxHex = signAndSerialize(tx, chain, walletName, passphrase);
    const timeout = parseTimeout(flags.timeout);
    const result = await broadcastAndWait(client, signedTxHex, { timeout });

    print({
      ...summary,
      tx: {
        hash: result.hash,
        status: result.status,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
      },
      executed: true,
    }, formatSwapQuote);
  } catch (err) {
    handleTradingError(err, "send_error");
  }
}

async function estimateGasWithFallback(client, account, to, data, fallback) {
  try {
    const estimate = await client.estimateGas({ account, to, data, value: 0n });
    return (estimate * 120n) / 100n; // 20% buffer
  } catch (err) {
    const msg = err.message || "";
    // If the revert reason indicates the transfer will definitely fail, abort
    if (msg.includes("exceeds balance") || msg.includes("insufficient") || msg.includes("underflow")) {
      const error = new Error(
        `Transfer would fail: ${msg.split("\n")[0]}. Check your token balance.`
      );
      error.code = "transfer_would_revert";
      error.suggestion = "Check your balance with: zerion positions";
      throw error;
    }
    process.stderr.write(
      `WARNING: Gas estimation failed (${msg.split("\n")[0]}). ` +
      `Using fallback of ${fallback}. The transaction may revert and you will lose gas fees.\n`
    );
    return fallback;
  }
}
