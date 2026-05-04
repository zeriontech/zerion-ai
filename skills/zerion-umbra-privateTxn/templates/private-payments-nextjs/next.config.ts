import type { NextConfig } from "next";

// The browser talks to the UTXO indexer and relayer DIRECTLY (CORS is
// allowed on those services). Only the data-indexer is proxied via a
// `/proxy/data-indexer/...` rewrite — it serves all-rounder onchain
// data (deposits, claims, withdrawals, transfers, conversions, eta
// snapshots, computations, etc.) and we proxy it to keep the upstream
// host out of the browser bundle and to make swapping hosts trivial.
//
// Server-only env var `DATA_INDEXER_UPSTREAM` sets where the proxy
// forwards to. It is NEVER exposed to the browser. The browser-facing
// `NEXT_PUBLIC_DATA_INDEXER_URL` always stays at `/proxy/data-indexer`.
//
// `transpilePackages` is required because the Umbra SDK ships ESM that
// Next still wants to pre-process.

function dataIndexerUpstream(): string {
  return (
    process.env["DATA_INDEXER_UPSTREAM"]?.trim() ||
    "https://data-indexer.api.umbraprivacy.com"
  );
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@umbra-privacy/sdk", "@umbra-privacy/web-zk-prover"],
  webpack: (config) => {
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      fs: false,
    };
    return config;
  },
  async rewrites() {
    return [
      { source: "/proxy/data-indexer/:path*", destination: `${dataIndexerUpstream()}/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
