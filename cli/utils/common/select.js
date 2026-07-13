/**
 * Interactive single-select menu — ↑/↓ (or j/k) navigate, Enter confirm,
 * optional Esc to go back. Shared by the security-policy picker and the
 * auth-method picker.
 *
 * Renders to stderr so stdout stays a clean JSON channel, and requires a
 * raw-mode TTY (callers must guard on `process.stdin.isTTY`).
 */

// ANSI — bright variants for dark terminal contrast.
export const BOLD = "\x1b[1m";
export const RESET = "\x1b[0m";
export const WHITE = "\x1b[97m";
export const GREEN = "\x1b[92m";
export const GRAY = "\x1b[90m";

export const BACK = Symbol("back");

/**
 * @param {string} title
 * @param {string[]} items
 * @param {{ defaultIndex?: number, allowBack?: boolean }} [opts]
 * @returns {Promise<number | typeof BACK>} the selected index, or BACK if Esc
 *   was pressed while `allowBack` is enabled.
 */
export function selectOne(title, items, { defaultIndex = 0, allowBack = true } = {}) {
  let cursor = defaultIndex;
  // title + items + hint = exact line count for re-draw
  const menuLines = items.length + 2;

  function render(clear) {
    if (clear) process.stderr.write(`\x1b[${menuLines}A\x1b[J`);
    process.stderr.write(`${WHITE}${BOLD}${title}${RESET}\n`);
    for (let i = 0; i < items.length; i++) {
      if (i === cursor) {
        process.stderr.write(`  ${GREEN}>${RESET} ${WHITE}${BOLD}${items[i]}${RESET}\n`);
      } else {
        process.stderr.write(`    ${GRAY}${items[i]}${RESET}\n`);
      }
    }
    const hint = allowBack
      ? "  ↑/↓ navigate · Enter confirm · Esc back"
      : "  ↑/↓ navigate · Enter confirm";
    process.stderr.write(`${GRAY}${hint}${RESET}\n`);
  }

  process.stderr.write("\n"); // spacing before first render only
  render(false);

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (key) => {
      const done = (val) => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write(`\x1b[${menuLines}A\x1b[J`);
        resolve(val);
      };
      if (key === "\r" || key === "\n") {
        done(cursor);
      } else if (allowBack && key === "\x1b" && key.length === 1) {
        done(BACK);
      } else if (key === "\x1b[A" || key === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        render(true);
      } else if (key === "\x1b[B" || key === "j") {
        cursor = (cursor + 1) % items.length;
        render(true);
      } else if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write("\n");
        process.exit(130);
      }
    };

    process.stdin.on("data", onData);
  });
}
