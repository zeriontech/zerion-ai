import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMaskedChunk, readPassphraseFromFile } from "#zerion/utils/common/prompt.js";

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

describe("applyMaskedChunk", () => {
  const KEY = "0x0ee04d8466aa0f5a05d3ab5a3f9f1e1c2b3a49586d7c8b9a0f1e2d3c4b5a6978";

  it("masks a typed character one-for-one", () => {
    assert.deepEqual(applyMaskedChunk("", "a"), {
      value: "a",
      echo: "*",
      done: false,
      abort: false,
    });
  });

  it("masks every character of a pasted key, not just the chunk", () => {
    const step = applyMaskedChunk("", KEY);
    assert.equal(step.value, KEY);
    assert.equal(step.echo, "*".repeat(KEY.length));
    assert.equal(step.done, false);
  });

  it("submits when a pasted key arrives with a trailing newline", () => {
    const step = applyMaskedChunk("", `${KEY}\n`);
    assert.equal(step.value, KEY);
    assert.equal(step.done, true);
    assert.equal(step.echo, "*".repeat(KEY.length));
  });

  it("submits on CRLF without keeping the CR", () => {
    const step = applyMaskedChunk("0xab", "cd\r\n");
    assert.equal(step.value, "0xabcd");
    assert.equal(step.done, true);
  });

  it("drops anything after the terminator so it cannot leak into the next prompt", () => {
    const step = applyMaskedChunk("", "secret\nleftover");
    assert.equal(step.value, "secret");
    assert.equal(step.echo, "*".repeat(6));
    assert.equal(step.done, true);
  });

  it("submits on Ctrl-D", () => {
    const step = applyMaskedChunk("abc", "\u0004");
    assert.equal(step.value, "abc");
    assert.equal(step.done, true);
  });

  it("aborts on Ctrl-C", () => {
    const step = applyMaskedChunk("abc", "\u0003");
    assert.equal(step.abort, true);
    assert.equal(step.done, false);
  });

  it("erases the last character on backspace", () => {
    const step = applyMaskedChunk("abc", "\u007F");
    assert.equal(step.value, "ab");
    assert.equal(step.echo, "\b \b");
  });

  it("ignores backspace on an empty buffer", () => {
    assert.deepEqual(applyMaskedChunk("", "\u007F"), {
      value: "",
      echo: "",
      done: false,
      abort: false,
    });
  });

  it("strips bracketed-paste markers", () => {
    const step = applyMaskedChunk("", `\u001B[200~${KEY}\u001B[201~`);
    assert.equal(step.value, KEY);
    assert.equal(step.echo, "*".repeat(KEY.length));
  });

  it("ignores arrow keys instead of masking them as input", () => {
    const step = applyMaskedChunk("ab", "\u001B[Ac");
    assert.equal(step.value, "abc");
    assert.equal(step.echo, "*");
  });

  it("ignores other control characters", () => {
    const step = applyMaskedChunk("", "\u0001a\u0002");
    assert.equal(step.value, "a");
    assert.equal(step.echo, "*");
  });

  it("keeps spaces so a mnemonic survives", () => {
    const words = "test test test test test test test test test test test junk";
    const step = applyMaskedChunk("", `${words}\r`);
    assert.equal(step.value, words);
    assert.equal(step.done, true);
    assert.equal(step.echo, "*".repeat(words.length));
  });
});
