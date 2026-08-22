// Pretty-mode rendering of the two things WLT-2076 added to the JSON payloads:
// `notes` (why a Solana result looks thinner than asked for) and DeFi rows in
// `portfolio` (which the total now includes).
//
// Assertions strip ANSI so they don't encode the colour scheme.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPortfolio, formatPositions } from "#zerion/utils/common/format.js";

const strip = (s) => s.replace(/\[[0-9;]*m/g, "");

const WALLET = { name: "sol-ro", address: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9" };
const NOTE = "Solana has no DeFi positions in the Zerion API yet — showing token holdings only.";

describe("formatPortfolio — notes", () => {
  const base = {
    wallet: WALLET,
    portfolio: { total: 1000, change_24h: null, currency: "usd" },
    positions: [{ symbol: "SOL", chain: "solana", value: 1000, quantity: 5 }],
    positionCount: 1,
  };

  it("prints the note in pretty mode", () => {
    const out = strip(formatPortfolio({ ...base, notes: [NOTE] }));
    assert.match(out, /token holdings only/);
  });

  it("prints nothing extra when there are no notes", () => {
    const out = strip(formatPortfolio(base));
    assert.doesNotMatch(out, /ⓘ/);
  });

  it("shows the chain when the total is a chain slice", () => {
    const out = strip(formatPortfolio({ ...base, chain: "base" }));
    assert.match(out.split("\n")[0], /base/);
  });
});

describe("formatPortfolio — DeFi rows", () => {
  // 8 ETH held + 4 ETH staked: two rows, same symbol, same chain. Without a
  // type column this reads as a double count.
  const data = {
    wallet: { name: "evm", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    portfolio: { total: 12000, change_24h: 10, currency: "usd" },
    positions: [
      { symbol: "ETH", chain: "ethereum", value: 8000, quantity: 8, position_type: "wallet", protocol: null },
      { symbol: "ETH", chain: "ethereum", value: 4000, quantity: 4, position_type: "staked", protocol: "Lido" },
    ],
    positionCount: 2,
  };

  it("labels the protocol row with its type and dapp", () => {
    const rows = strip(formatPortfolio(data)).split("\n").filter((l) => l.includes("ETH"));
    const staked = rows.find((l) => l.includes("4.0000"));
    assert.match(staked, /staked/);
    assert.match(staked, /Lido/);
  });

  it("leaves the plain wallet row unlabelled", () => {
    const rows = strip(formatPortfolio(data)).split("\n").filter((l) => l.includes("ETH"));
    const held = rows.find((l) => l.includes("8.0000"));
    assert.doesNotMatch(held, /staked|Lido/);
  });

  it("adds no Type column when every row is a plain holding", () => {
    const simple = { ...data, positions: [data.positions[0]] };
    assert.doesNotMatch(strip(formatPortfolio(simple)), /Type/);
  });
});

describe("formatPositions — notes", () => {
  const base = {
    wallet: WALLET,
    positions: [{ symbol: "SOL", chain: "solana", value: 1000, quantity: 5 }],
    count: 1,
    filter: "all",
  };

  it("prints the note above the table", () => {
    const lines = strip(formatPositions({ ...base, notes: [NOTE] })).split("\n");
    const noteAt = lines.findIndex((l) => l.includes("token holdings only"));
    const headerAt = lines.findIndex((l) => l.includes("Token"));
    assert.ok(noteAt > -1, "note not rendered");
    assert.ok(noteAt < headerAt, "note rendered below the table header");
  });

  it("renders unchanged without notes", () => {
    assert.doesNotMatch(strip(formatPositions(base)), /ⓘ/);
  });
});

// `portfolio.change_24h` carries `changes.absolute_1d` — dollars. It used to be
// printed through the percent formatter, so a -$4,048 day read as "-4048.26%".
describe("formatPortfolio — 24h change units", () => {
  const withChange = (change_24h) => ({
    wallet: { name: "w", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    portfolio: { total: 27_369_610.3, change_24h, currency: "usd" },
    positions: [],
    positionCount: 0,
  });

  it("renders a negative change as dollars, not a percentage", () => {
    const out = strip(formatPortfolio(withChange(-4048.26)));
    assert.match(out, /24h: -\$4,048\.26/);
    assert.doesNotMatch(out, /%/);
  });

  it("signs a positive change", () => {
    assert.match(strip(formatPortfolio(withChange(4370.9))), /24h: \+\$4,370\.90/);
  });

  it("renders a missing change as a dash", () => {
    assert.match(strip(formatPortfolio(withChange(null))), /24h: -\n?/);
  });
});
