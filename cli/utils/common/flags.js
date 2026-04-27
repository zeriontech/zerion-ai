/**
 * Minimal flag parser — ported from zerion-ai/cli/lib.mjs
 *
 * Supports: --key value, --key=value, --bool (true), --no-bool (false)
 * Returns: { rest: string[], flags: Record<string, string|boolean> }
 */
export function parseFlags(argv) {
  const rest = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        // --key=value
        const key = arg.slice(2, eqIndex);
        flags[key] = arg.slice(eqIndex + 1);
      } else if (arg.startsWith("--no-")) {
        // --no-bool
        flags[arg.slice(5)] = false;
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      rest.push(arg);
    }
  }

  return { rest, flags };
}
