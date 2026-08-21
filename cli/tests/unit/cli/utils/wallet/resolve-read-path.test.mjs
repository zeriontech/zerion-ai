// The read/sign split in resolveWallet (WLT-2076).
//
// Read commands funnel through resolveAddressOrWallet, which used to resolve
// wallets with the same rules as `send`/`swap` — including a signing guard that
// compared the wallet's ecosystem against a chain the user never asked for. A
// saved Solana wallet therefore failed all five read commands with
// `readonly_chain_mismatch` on the `ethereum` default.
//
// Uses a temp HOME so neither ~/.zerion nor ~/.ows is touched (CONFIG_DIR is
// derived from HOME at import time, so HOME must be set before the imports).

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SOL = "ebDDhKWSBXPirnzXgFWTTArfymyG4n5fpg1Y5UgwNRY";

let resolve;
let ows;
let config;
let constants;
let tmpHome;
const origHome = process.env.HOME;

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "zerion-resolve-"));
  process.env.HOME = tmpHome;
  const readonly = await import("#zerion/utils/wallet/readonly.js");
  readonly.addReadonly("ro-evm", EVM);
  readonly.addReadonly("ro-sol", SOL);
  ows = await import("#zerion/utils/wallet/keystore.js");
  config = await import("#zerion/utils/config.js");
  constants = await import("#zerion/utils/common/constants.js");
  resolve = await import("#zerion/utils/wallet/resolve.js");
});

after(() => {
  process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

class Exited extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

// resolveWallet reports failure with printError + process.exit rather than by
// throwing, so intercept both to assert on the structured error.
function runExpectingExit(fn) {
  const origExit = process.exit;
  const origWrite = process.stderr.write;
  let stderr = "";
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  process.exit = (code) => { throw new Exited(code); };
  try {
    fn();
    return { exited: false };
  } catch (err) {
    if (!(err instanceof Exited)) throw err;
    return { exited: true, code: err.code, error: JSON.parse(stderr).error };
  } finally {
    process.exit = origExit;
    process.stderr.write = origWrite;
  }
}

describe("resolveWallet — read path, read-only Solana wallet", () => {
  it("resolves with no --chain instead of failing on the ethereum default", () => {
    const result = resolve.resolveWallet({ wallet: "ro-sol" }, [], { purpose: "read" });
    assert.equal(result.address, SOL);
    assert.equal(result.readOnly, true);
  });

  it("resolves when --chain solana is passed explicitly", () => {
    const result = resolve.resolveWallet(
      { wallet: "ro-sol", chain: "solana" }, [], { purpose: "read" },
    );
    assert.equal(result.address, SOL);
  });

  it("still reports a mismatch when an EVM --chain is asked for explicitly", () => {
    const { exited, code, error } = runExpectingExit(() =>
      resolve.resolveWallet({ wallet: "ro-sol", chain: "ethereum" }, [], { purpose: "read" }),
    );
    assert.ok(exited);
    assert.equal(code, 1);
    assert.equal(error.code, "readonly_chain_mismatch");
    // Read wording — the old message blamed signing on a command that reads.
    assert.match(error.message, /nothing to read/);
    assert.doesNotMatch(error.message, /sign/);
  });
});

describe("resolveWallet — read path, read-only EVM wallet", () => {
  it("resolves with no --chain", () => {
    const result = resolve.resolveWallet({ wallet: "ro-evm" }, [], { purpose: "read" });
    assert.equal(result.address, EVM);
  });

  it("resolves under --chain base (any EVM chain matches)", () => {
    const result = resolve.resolveWallet(
      { wallet: "ro-evm", chain: "base" }, [], { purpose: "read" },
    );
    assert.equal(result.address, EVM);
  });

  it("reports a mismatch under an explicit --chain solana", () => {
    const { error } = runExpectingExit(() =>
      resolve.resolveWallet({ wallet: "ro-evm", chain: "solana" }, [], { purpose: "read" }),
    );
    assert.equal(error.code, "readonly_chain_mismatch");
  });
});

describe("resolveWallet — sign path is unchanged", () => {
  it("still refuses a Solana wallet on the ethereum default", () => {
    const { error } = runExpectingExit(() => resolve.resolveWallet({ wallet: "ro-sol" }));
    assert.equal(error.code, "readonly_chain_mismatch");
    assert.match(error.message, /can't sign/);
  });

  it("still refuses an EVM wallet on --chain solana", () => {
    const { error } = runExpectingExit(() =>
      resolve.resolveWallet({ wallet: "ro-evm", chain: "solana" }),
    );
    assert.equal(error.code, "readonly_chain_mismatch");
    assert.match(error.message, /can't sign on Solana/);
  });

  it("accepts a matching ecosystem", () => {
    assert.equal(
      resolve.resolveWallet({ wallet: "ro-sol", chain: "solana" }).address, SOL,
    );
    assert.equal(
      resolve.resolveWallet({ wallet: "ro-evm", chain: "base" }).address, EVM,
    );
  });

  it("defaults to sign rules when no purpose is given", () => {
    // The 4 trading commands call resolveWallet(flags) with no options — the
    // guard must not become opt-in.
    const { exited } = runExpectingExit(() => resolve.resolveWallet({ wallet: "ro-sol" }, []));
    assert.ok(exited, "sign guard did not fire without an explicit purpose");
  });
});

describe("resolveAddress — name suffixes", () => {
  it("explains that .sol is unsupported instead of falling through", async () => {
    // Previously this fell through to the wallet-name lookup and reported
    // `wallet_not_found`, telling the caller to audit a wallet list that never
    // had the name in it.
    await assert.rejects(
      () => resolve.resolveAddress("toly.sol"),
      (err) => {
        assert.equal(err.code, "sns_not_supported");
        assert.match(err.message, /base58/);
        return true;
      },
    );
  });

  it("passes through raw addresses of both ecosystems", async () => {
    assert.equal(await resolve.resolveAddress(EVM), EVM);
    assert.equal(await resolve.resolveAddress(SOL), SOL);
  });

  it("tags an unrecognised string with invalid_address", async () => {
    await assert.rejects(
      () => resolve.resolveAddress("not-an-address"),
      (err) => {
        assert.equal(err.code, "invalid_address");
        return true;
      },
    );
  });
});

// OWS gives a `--sol-key` wallet an EVM account too, but its secp256k1 key is
// generated at random — that 0x address belongs to nobody. Reading it returned
// a stranger's empty portfolio with no error at all, which is worse than the
// read-only case that at least failed loudly.
describe("resolveWallet — read path, --sol-key keystore wallet", () => {
  let solAddress;
  let randomEvmAddress;

  before(() => {
    const wallet = ows.importFromKey(
      "solonly", randomBytes(32).toString("hex"), undefined, "solana",
    );
    config.setWalletOrigin("solonly", constants.WALLET_ORIGIN.SOL_KEY);
    solAddress = wallet.solAddress;
    randomEvmAddress = wallet.evmAddress;
  });

  it("reads the owned Solana account, not the random EVM one", () => {
    const result = resolve.resolveWallet({ wallet: "solonly" }, [], { purpose: "read" });
    assert.equal(result.address, solAddress);
    assert.notEqual(result.address, randomEvmAddress);
  });

  it("refuses an explicit EVM --chain rather than reading the random address", () => {
    const { error } = runExpectingExit(() =>
      resolve.resolveWallet({ wallet: "solonly", chain: "ethereum" }, [], { purpose: "read" }),
    );
    assert.equal(error.code, "no_account_for_chain");
  });

  it("reads under --chain solana", () => {
    const result = resolve.resolveWallet(
      { wallet: "solonly", chain: "solana" }, [], { purpose: "read" },
    );
    assert.equal(result.address, solAddress);
  });
});
