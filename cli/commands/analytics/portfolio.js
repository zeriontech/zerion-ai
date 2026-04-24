import * as api from "../../lib/api/client.js";
import { print, printError } from "../../lib/util/output.js";
import { resolveAddressOrWallet } from "../../lib/wallet/resolve.js";
import { formatPortfolio } from "../../lib/util/format.js";
import { isX402Enabled } from "../../lib/api/x402.js";

export default async function portfolio(args, flags) {
  const useX402 = flags.x402 === true || isX402Enabled();
  const { walletName, address } = await resolveAddressOrWallet(args, flags);

  try {
    const [portfolioRes, positionsRes] = await Promise.all([
      api.getPortfolio(address, { useX402 }),
      api.getPositions(address, {
        chainId: flags.chain,
        positionFilter: "only_simple",
        useX402,
      }),
    ]);

    const total = portfolioRes.data?.attributes?.total?.positions ?? 0;
    const change24h =
      portfolioRes.data?.attributes?.changes?.absolute_1d ?? null;

    const positions = (positionsRes.data || [])
      .map((p) => ({
        name: p.attributes.fungible_info?.name,
        symbol: p.attributes.fungible_info?.symbol,
        chain: p.relationships?.chain?.data?.id,
        quantity: p.attributes.quantity?.float,
        value: p.attributes.value,
        price: p.attributes.price,
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
    print(data, formatPortfolio);
  } catch (err) {
    printError(err.code || "portfolio_error", err.message);
    process.exit(1);
  }
}
