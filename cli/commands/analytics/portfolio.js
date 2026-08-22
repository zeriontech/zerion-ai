import * as api from "../../utils/api/client.js";
import { print, printError } from "../../utils/common/output.js";
import { resolveAddressOrWallet } from "../../utils/wallet/resolve.js";
import { formatPortfolio } from "../../utils/common/format.js";
import { resolveReadChainAsync, resolvePositionFilterForAddress } from "../../utils/common/validate.js";
import { portfolioTotals } from "../../utils/common/portfolio.js";
import { resolveAuth } from "../../utils/api/auth.js";

export default async function portfolio(args, flags) {
  // Validate against the live catalog (not the static 14-chain registry) so any
  // chain Zerion indexes can be filtered on, and a typo reports
  // `unsupported_chain` rather than a raw 400 from the API.
  const chainCheck = await resolveReadChainAsync(flags.chain);
  if (chainCheck.error) {
    printError(chainCheck.error.code, chainCheck.error.message, {
      suggestion: chainCheck.error.suggestion,
    });
    process.exit(1);
  }
  const chainId = chainCheck.chainId;

  const { walletName, address } = await resolveAddressOrWallet(args, flags);

  // `portfolio` has no --positions flag: it always wants the whole wallet.
  // On Solana that resolves to `only_simple`, the only filter the positions
  // endpoint accepts there.
  const filterCheck = resolvePositionFilterForAddress(address, undefined);

  try {
    const auth = resolveAuth(flags);
    const [portfolioRes, positionsRes] = await Promise.all([
      api.getPortfolio(address, { auth }),
      api.getPositions(address, {
        chainId,
        positionFilter: filterCheck.filter,
        auth,
      }),
    ]);

    // No `?? 0`: portfolioTotals keeps "the API said nothing" as null, and
    // `analyze` reports the same null — coercing here made the two commands
    // disagree ($0.00 vs null) on a chain the wallet holds nothing on.
    const { total, change24h } = portfolioTotals(portfolioRes.data?.attributes, chainId);

    const positions = (positionsRes.data || [])
      .map((p) => ({
        name: p.attributes.fungible_info?.name,
        symbol: p.attributes.fungible_info?.symbol,
        chain: p.relationships?.chain?.data?.id,
        quantity: p.attributes.quantity?.float,
        value: p.attributes.value,
        price: p.attributes.price,
        // The total now includes DeFi, so the list does too. Without these an
        // 8 ETH wallet row and a 4 ETH staked row render identically and read
        // like a double count.
        position_type: p.attributes.position_type ?? null,
        protocol: p.attributes.application_metadata?.name ?? p.attributes.protocol ?? null,
      }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);

    const data = {
      wallet: { name: walletName, address },
      portfolio: {
        total,
        change_24h: change24h,
        currency: "usd",
      },
      positions: positions.slice(0, flags.limit ? parseInt(flags.limit, 10) : 20),
      positionCount: positions.length,
    };
    if (chainId) data.chain = chainId;
    if (filterCheck.note) data.notes = [filterCheck.note];
    print(data, formatPortfolio);
  } catch (err) {
    printError(err.code || "portfolio_error", err.message);
    process.exit(1);
  }
}
