import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPassphraseFromFile } from "#zerion/utils/common/prompt.js";

const isWindows = process.platform === "win32";

describe("readPassphraseFromFile", () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "zerion-pass-"));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when file does not exist", () => {
    const missing = join(dir, "nope.txt");
    assert.throws(() => readPassphraseFromFile(missing), /not found/i);
  });

  it("refuses files with group-readable perms (POSIX only)", { skip: isWindows }, () => {
    const path = join(dir, "loose.txt");
    writeFileSync(path, "my-pass", { mode: 0o644 });
    chmodSync(path, 0o644);
    assert.throws(() => readPassphraseFromFile(path), /insecure permissions/i);
  });

  it("refuses files with world-readable perms (POSIX only)", { skip: isWindows }, () => {
    const path = join(dir, "world.txt");
    writeFileSync(path, "my-pass", { mode: 0o604 });
    chmodSync(path, 0o604);
    assert.throws(() => readPassphraseFromFile(path), /insecure permissions/i);
  });

  it("reads a 0600 file and strips one trailing LF", () => {
    const path = join(dir, "good-lf.txt");
    writeFileSync(path, "my-pass\n", { mode: 0o600 });
    chmodSync(path, 0o600);
    assert.equal(readPassphraseFromFile(path), "my-pass");
  });

  it("reads a 0600 file and strips one trailing CRLF", () => {
    const path = join(dir, "good-crlf.txt");
    writeFileSync(path, "my-pass\r\n", { mode: 0o600 });
    chmodSync(path, 0o600);
    assert.equal(readPassphraseFromFile(path), "my-pass");
  });

  it("preserves leading and trailing spaces inside passphrase", () => {
    const path = join(dir, "spaces.txt");
    writeFileSync(path, "  pass with spaces  \n", { mode: 0o600 });
    chmodSync(path, 0o600);
    assert.equal(readPassphraseFromFile(path), "  pass with spaces  ");
  });

  it("rejects empty file (newline only)", () => {
    const path = join(dir, "empty.txt");
    writeFileSync(path, "\n", { mode: 0o600 });
    chmodSync(path, 0o600);
    assert.throws(() => readPassphraseFromFile(path), /empty/i);
  });

  it("rejects zero-byte file", () => {
    const path = join(dir, "zero.txt");
    writeFileSync(path, "", { mode: 0o600 });
    chmodSync(path, 0o600);
    assert.throws(() => readPassphraseFromFile(path), /empty/i);
  });
});
