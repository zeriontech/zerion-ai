// app/utils/swap.ts
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, formatEther } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { erc20Abi } from 'viem'

const ZEROX_API = 'https://api.0x.org/swap/allowance-holder/quote'
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

export async function executeDirectSwap(params: {
  toToken: string
  amount: string
  walletAddress: string
  privateKey: string
}): Promise<{ txHash: string }> {
  const account = privateKeyToAccount(params.privateKey as `0x${string}`)
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org'

  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) })
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) })

  const wallet = params.walletAddress as `0x${string}`
  const toToken = params.toToken as `0x${string}`

  // 1. Check ETH balance for gas
  const ethBalance = await publicClient.getBalance({ address: wallet })
  if (ethBalance === 0n) {
    throw new Error(
      `FALLBACK WALLET BALANCE IS 0 ETH on Base.\n` +
      `👉 FUND THIS WALLET: ${params.walletAddress}\n` +
      `   Need: ~$${params.amount} USDC + ~0.0001 ETH (~$0.05 gas) for swap\n` +
      `   Base RPC: ${rpcUrl}`
    )
  }
  if (ethBalance < parseUnits('0.00005', 18)) {
    throw new Error(
      `Insufficient ETH for gas. Balance: ${formatEther(ethBalance)} ETH.\n` +
      `👉 FUND THIS WALLET: ${params.walletAddress}\n` +
      `   Need: at least 0.0001 ETH (~$0.05) on Base for gas.`
    )
  }

  // 2. Check USDC balance
  const usdcBalance = await publicClient.readContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [wallet],
  })
  const amountBigInt = parseUnits(params.amount, 6)
  if (usdcBalance < amountBigInt) {
    throw new Error(
      `Insufficient USDC. Have ${formatUnits(usdcBalance, 6)} USDC, need ${params.amount} USDC.\n` +
      `👉 FUND THIS WALLET: ${params.walletAddress}\n` +
      `   Need: at least $${params.amount} USDC on Base.`
    )
  }

  // 3. Get swap data from 0x
  const url = `${ZEROX_API}?` + new URLSearchParams({
    chainId: '8453',
    sellToken: USDC_ADDRESS,
    buyToken: params.toToken,
    sellAmount: parseUnits(params.amount, 6).toString(),
    taker: params.walletAddress,
  })

  const res = await fetch(url, {
    headers: {
      '0x-api-key': process.env.ZEROX_API_KEY || 'free',
      'Accept': 'application/json',
    },
  })
  const json = await res.json()

  if (!json.transaction) {
    throw new Error(`0x swap error: ${JSON.stringify(json)}`)
  }

  const swap = json.transaction

  // 4. Ensure USDC approval for the swap router (0x uses allowance holder)
  const router = swap.to as `0x${string}`
  const allowance = await publicClient.readContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [wallet, router],
  })

  if (allowance < amountBigInt) {
    const approveHash = await walletClient.writeContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: 'approve',
      args: [router, parseUnits('1000000', 6)],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveHash })
  }

  // 5. Execute swap
  const txHash = await walletClient.sendTransaction({
    to: router,
    data: swap.data as `0x${string}`,
    value: BigInt(swap.value || '0'),
    gas: BigInt(swap.gas || '300000'),
  })

  return { txHash }
}
