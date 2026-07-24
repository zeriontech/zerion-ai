/**
 * Flags that may be passed more than once and collect into an array
 * (e.g. `zerion bundle --group a --group b` → `{ group: ["a", "b"] }`). Every
 * other flag keeps the historical **last-wins** semantics, so existing callers
 * are unaffected.
 */
const REPEATABLE_FLAGS = new Set(["group"]);

/**
 * Minimal flag parser — ported from zerion-ai/cli/lib.mjs
 *
 * Supports: --key value, --key=value, --bool (true), --no-bool (false)
 * Returns: { rest: string[], flags: Record<string, string|boolean|Array> }
 */
export function parseFlags(argv) {
  const rest = [];
  const flags = {};

  // Assign a flag value. Repeatable flags accumulate into an array across
  // occurrences; all other flags follow last-wins.
  const assign = (key, value) => {
    if (REPEATABLE_FLAGS.has(key) && Object.prototype.hasOwnProperty.call(flags, key)) {
      if (Array.isArray(flags[key])) flags[key].push(value);
      else flags[key] = [flags[key], value];
    } else {
      flags[key] = value;
    }
  };

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
        assign(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
      } else if (arg.startsWith("--no-")) {
        // --no-bool
        assign(arg.slice(5), false);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          assign(key, next);
          i++;
        } else {
          assign(key, true);
        }
      }
    } else {
      rest.push(arg);
    }
  }

  return { rest, flags };
}
