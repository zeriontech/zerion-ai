/**
 * Browser (OAuth-style) authentication for the Zerion CLI.
 *
 * Mirrors the modern CLI login pattern (Claude Code, `gh auth login`): the CLI
 * starts a throwaway loopback HTTP server, opens dashboard.zerion.io/oauth/authorize
 * in the browser, and the dashboard redirects back to the loopback server with
 * the credential once the user approves — the key never leaves the machine.
 *
 * Protocol (dashboard side — api-developer-dashboard, ADR 0001):
 *   - client_id   = "zerion-cli"
 *   - redirect_uri must be loopback http (127.0.0.1 / localhost / [::1]),
 *     any port, any path
 *   - `state` is required and echoed back verbatim (CSRF guard)
 *   - approve → GET redirect_uri?code=<API_KEY>&state=<state>
 *               (v1: the `code` value IS the raw API key — no token exchange)
 *   - deny    → GET redirect_uri?error=access_denied&state=<state>
 * On success the loopback server replies to the browser with a 302 to the
 * dashboard's /oauth/success page so the user sees a friendly confirmation and
 * can close the tab.
 */

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { DASHBOARD_URL } from "../common/constants.js";
import { openBrowser } from "../common/browser.js";

const CLIENT_ID = "zerion-cli";
const CALLBACK_PATH = "/callback";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function authError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Bind to 127.0.0.1 only — the callback carries the raw API key and must never
// be reachable off-host. Port 0 lets the OS assign an ephemeral port.
function listenLoopback(server) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(server.address().port);
    });
  });
}

export function buildAuthorizeUrl({ dashboardUrl, redirectUri, state }) {
  const url = new URL("/oauth/authorize", dashboardUrl);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Run the browser login flow. Resolves with `{ ok: true, apiKey }` once the
 * dashboard redirects the key back; rejects with a coded Error on
 * timeout / denial / state-mismatch / no-code.
 *
 * @param {{
 *   dashboardUrl?: string,
 *   open?: boolean,
 *   timeoutMs?: number,
 *   log?: (line?: string) => void,
 * }} [opts]
 */
export async function authenticateWithBrowser({
  dashboardUrl = DASHBOARD_URL,
  open = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = (line = "") => process.stderr.write(line + "\n"),
} = {}) {
  const state = randomBytes(32).toString("base64url");
  const server = createServer();
  const port = await listenLoopback(server);

  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const authorizeUrl = buildAuthorizeUrl({ dashboardUrl, redirectUri, state });
  const successUrl = new URL("/oauth/success", dashboardUrl).toString();

  const waiter = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        authError(
          "oauth_timeout",
          `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for browser authorization.`
        )
      );
    }, timeoutMs);

    const settle = (fn, arg) => {
      clearTimeout(timer);
      fn(arg);
    };

    server.on("request", (req, res) => {
      let reqUrl;
      try {
        reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);
      } catch {
        res.writeHead(400).end();
        return;
      }

      // Ignore stray requests (favicon, health checks) — only the callback
      // path settles the flow.
      if (reqUrl.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
        return;
      }

      const params = reqUrl.searchParams;
      const returnedState = params.get("state");
      const error = params.get("error");
      const code = params.get("code");

      // CSRF guard — verify state before trusting `code`/`error`.
      if (returnedState !== state) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Authorization failed: state mismatch. You can close this tab.");
        settle(
          reject,
          authError("oauth_state_mismatch", "State mismatch — authorization rejected (possible CSRF).")
        );
        return;
      }
      if (error) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(`Authorization ${error}. You can close this tab and return to the CLI.`);
        settle(reject, authError("oauth_denied", `Authorization was denied (${error}).`));
        return;
      }
      if (!code) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Authorization failed: no credential returned. You can close this tab.");
        settle(reject, authError("oauth_no_code", "No credential returned by the dashboard."));
        return;
      }

      // Success — bounce the browser to the dashboard's confirmation page.
      res.writeHead(302, { location: successUrl });
      res.end();
      settle(resolve, code);
    });

    server.on("error", (err) => settle(reject, err));
  });

  log("  Opening your browser to authorize with the Zerion dashboard:");
  log(`    ${authorizeUrl}`);
  log("");
  if (open) openBrowser(authorizeUrl);
  log("  Waiting for you to approve in the browser… (Ctrl-C to cancel)");

  try {
    const apiKey = await waiter;
    return { ok: true, apiKey };
  } finally {
    server.close();
  }
}
