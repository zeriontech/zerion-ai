import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { readSecret, readPassphrase, readPassphraseFromFile } from "#zerion/utils/common/prompt.js";

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

describe("readSecret masked input", () => {
  const KEY = "0x0ee04d8466aa0f5a05d3ab5a3f9f1e1c2b3a49586d7c8b9a0f1e2d3c4b5a6978";
  const PROMPT = "Enter EVM private key (hex): ";
  const BACKSPACE = "\u007F";
  const CTRL_C = "\u0003";
  const CTRL_D = "\u0004";
  const CTRL_U = "\u0015"; // kill line
  const ESC = "\u001B";

  let realStdin;
  let realWrite;
  let realExit;

  // readline in terminal mode only needs isTTY + setRawMode, so a PassThrough
  // standing in for stdin exercises the real prompt without needing a pty.
  function fakeTty() {
    const stream = new PassThrough();
    stream.isTTY = true;
    stream.setRawMode = () => stream;
    return stream;
  }

  function withStdin(stream) {
    Object.defineProperty(process, "stdin", { value: stream, configurable: true });
  }

  before(() => {
    realStdin = process.stdin;
    realWrite = process.stderr.write;
    realExit = process.exit;
  });

  after(() => {
    withStdin(realStdin);
    process.stderr.write = realWrite;
    process.exit = realExit;
  });

  /**
   * Drive one masked prompt: returns the resolved secret plus everything that
   * reached the screen, so a test can assert the secret was never echoed.
   */
  async function prompt(chunks) {
    const stream = fakeTty();
    withStdin(stream);

    let written = "";
    process.stderr.write = (str) => {
      written += str;
      return true;
    };

    const pending = readSecret(PROMPT, { mask: true });
    for (const chunk of chunks) stream.write(chunk);
    const value = await pending;

    process.stderr.write = realWrite;
    return { value, written };
  }

  it("returns the typed secret without echoing it", async () => {
    const { value, written } = await prompt(["s", "e", "c", "r", "e", "t", "\r"]);
    assert.equal(value, "secret");
    assert.equal(written, `${PROMPT}\n`);
  });

  it("keeps a key pasted as one chunk intact and off the screen", async () => {
    const { value, written } = await prompt([`${KEY}\n`]);
    assert.equal(value, KEY);
    assert.equal(written, `${PROMPT}\n`);
  });

  it("never echoes an asterisk or any of the secret's characters", async () => {
    const { written } = await prompt([`${KEY}\n`]);
    assert.ok(!written.includes("*"), "expected no asterisks");
    assert.ok(!written.includes(KEY.slice(2, 10)), "expected no key characters");
  });

  it("submits on a bare CR and on LF alike", async () => {
    assert.equal((await prompt(["abc\r"])).value, "abc");
    assert.equal((await prompt(["abc\n"])).value, "abc");
  });

  it("erases the last character on backspace", async () => {
    const { value } = await prompt(["0xab", BACKSPACE, "c\r"]);
    assert.equal(value, "0xac");
  });

  it("ignores backspace on an empty buffer", async () => {
    const { value } = await prompt([BACKSPACE, "ab\r"]);
    assert.equal(value, "ab");
  });

  it("strips bracketed-paste markers from a pasted key", async () => {
    const { value } = await prompt([`${ESC}[200~${KEY}${ESC}[201~`, "\r"]);
    assert.equal(value, KEY);
  });

  it("ignores arrow keys instead of taking them as input", async () => {
    const { value } = await prompt(["ab", `${ESC}[A`, "c\r"]);
    assert.equal(value, "abc");
  });

  it("keeps the inner spaces of a mnemonic and trims the edges", async () => {
    const words = "test test test test test test test test test test test junk";
    const { value } = await prompt([`  ${words}  \r`]);
    assert.equal(value, words);
  });

  it("exits 130 on Ctrl-C", async () => {
    const codes = [];
    process.exit = (code) => codes.push(code);
    await prompt(["abc", CTRL_C]);
    process.exit = realExit;
    assert.deepEqual(codes, [130]);
  });

  it("resolves empty on Ctrl-D at an empty prompt rather than hanging", async () => {
    const { value } = await prompt([CTRL_D]);
    assert.equal(value, "");
  });

  it("falls back to line-buffered reads when stdin is not a TTY", async () => {
    const stream = new PassThrough();
    stream.isTTY = false;
    withStdin(stream);

    const pending = readSecret(PROMPT, { mask: true });
    stream.write(`${KEY}\n`);
    assert.equal(await pending, KEY);
  });

  it("clears the whole line on Ctrl-U (kill line)", async () => {
    const { value } = await prompt(["wrong", CTRL_U, "right\r"]);
    assert.equal(value, "right");
  });

  // `wallet import` runs prompts back to back (passphrase, confirm, key);
  // each one must get a fresh interface on the same stdin without dropping input.
  it("keeps two sequential prompts on the same stdin separate", async () => {
    const stream = fakeTty();
    withStdin(stream);

    let written = "";
    process.stderr.write = (str) => {
      written += str;
      return true;
    };

    const first = readSecret("Enter passphrase: ", { mask: true });
    stream.write("hunter2\r");
    assert.equal(await first, "hunter2");

    const second = readSecret(PROMPT, { mask: true });
    stream.write(`${KEY}\r`);
    assert.equal(await second, KEY);

    process.stderr.write = realWrite;
    assert.equal(written, `Enter passphrase: \n${PROMPT}\n`);
  });

  // A terminal paste can end in \r\n; the \r submits, and the leftover \n must
  // not submit the NEXT prompt as an empty line.
  it("does not leak the LF of a CRLF submit into the next prompt", async () => {
    const stream = fakeTty();
    withStdin(stream);
    process.stderr.write = () => true;

    const first = readSecret(PROMPT, { mask: true });
    stream.write("first-secret\r\n");
    assert.equal(await first, "first-secret");

    const second = readSecret(PROMPT, { mask: true });
    stream.write("second-secret\r");
    assert.equal(await second, "second-secret");

    process.stderr.write = realWrite;
  });
});

describe("readPassphrase confirm flow", () => {
  let realStdin;
  let realWrite;

  before(() => {
    realStdin = process.stdin;
    realWrite = process.stderr.write;
  });

  after(() => {
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
    process.stderr.write = realWrite;
  });

  it("retries on mismatch and never echoes either attempt", async () => {
    const stream = new PassThrough();
    stream.isTTY = true;
    stream.setRawMode = () => stream;
    Object.defineProperty(process, "stdin", { value: stream, configurable: true });

    // Reply to each prompt as it appears: first pair mismatches, second matches.
    const replies = ["first-try\r", "does-not-match\r", "correct horse\r", "correct horse\r"];
    let written = "";
    process.stderr.write = (str) => {
      written += str;
      if (str.endsWith("passphrase: ")) {
        const reply = replies.shift();
        if (reply) process.nextTick(() => stream.write(reply));
      }
      return true;
    };

    const value = await readPassphrase({ confirm: true });
    process.stderr.write = realWrite;

    assert.equal(value, "correct horse");
    assert.match(written, /do not match/i);
    assert.ok(!written.includes("first-try"), "expected no echo of the first attempt");
    assert.ok(!written.includes("correct horse"), "expected no echo of the passphrase");
  });
});
