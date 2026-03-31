/**
 * Output helpers — JSON to stdout, errors to stderr.
 * Matching the zerion-cli convention: agents parse stdout, humans read --pretty.
 */

export function print(value, prettyFormatter) {
  // If a pretty formatter is provided and we're in a TTY, use it
  if (prettyFormatter && _prettyMode) {
    process.stdout.write(prettyFormatter(value) + "\n");
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printQuiet(value) {
  const output = typeof value === "string" ? value : JSON.stringify(value);
  process.stdout.write(`${output}\n`);
}

export function printError(code, message, details = {}) {
  process.stderr.write(
    `${JSON.stringify({ error: { code, message, ...details } }, null, 2)}\n`
  );
}

let _prettyMode = false;

export function setPrettyMode(enabled) {
  _prettyMode = enabled;
}

export function isPrettyMode() {
  return _prettyMode;
}