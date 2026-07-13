import { print, printError } from "../utils/common/output.js";
import { getApiKey, setConfigValue } from "../utils/config.js";
import { DASHBOARD_URL } from "../utils/common/constants.js";
import { authenticateWithBrowser } from "../utils/api/oauth.js";
import { runInteractiveAuth } from "../utils/api/interactive-auth.js";

const HELP = {
  usage: "zerion login [options]",
  description:
    "Authenticate the CLI with your Zerion API key. Opens the Zerion dashboard in your browser and captures the key via a local loopback redirect (like `claude` / `gh auth login`), then saves it to config. Interactive runs also offer pasting an existing key or pay-per-call.",
  flags: {
    "--browser": "Skip the picker and go straight to browser authentication",
    "--no-open": "Print the authorize URL but don't auto-open the browser",
  },
  examples: {
    "zerion login": "Interactive — pick browser auth, paste a key, or pay-per-call",
    "zerion login --browser": "Go straight to browser authentication",
    "zerion login --browser --no-open": "Browser auth on a remote/headless host — copy the printed URL",
  },
};

function log(line = "") {
  process.stderr.write(line + "\n");
}

export default async function login(args, flags) {
  if (flags.help || flags.h) {
    print(HELP);
    return;
  }

  // parseFlags maps `--no-open` to `flags.open = false`.
  const open = flags.open !== false;
  const dashboardUrl = DASHBOARD_URL;

  if (getApiKey()) {
    log("  ! An API key is already configured — continuing will replace it.");
  }

  // --browser: skip the picker. Works without a TTY (approval happens in the
  // browser, out-of-band), so it's the headless-friendly path.
  if (flags.browser) {
    try {
      const { apiKey } = await authenticateWithBrowser({ dashboardUrl, open, log });
      setConfigValue("apiKey", apiKey);
      log("  ✓ Authenticated — API key saved to config");
      print({ ok: true, action: "login", method: "oauth" });
    } catch (err) {
      printError(err.code || "login_failed", err.message);
      process.exit(1);
    }
    return;
  }

  if (!process.stdin.isTTY) {
    printError(
      "not_interactive",
      "zerion login needs an interactive terminal. Use --browser for headless browser auth, " +
        "or set ZERION_API_KEY / run: zerion config set apiKey <your-key>"
    );
    process.exit(1);
  }

  const res = await runInteractiveAuth({ log, open, dashboardUrl });
  if (!res.ok) {
    printError(res.reason || "login_failed", res.message || "Login failed");
    process.exit(1);
  }

  print({
    ok: true,
    action: "login",
    method: res.method ?? null,
    skipped: Boolean(res.skipped),
    ...(res.reason ? { reason: res.reason } : {}),
  });
}
