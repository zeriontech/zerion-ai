/**
 * Browser-based login flow.
 *
 * Opens a dashboard URL that contains a PKCE code_challenge in the query
 * string and a session_id in the URL fragment. Once the user clicks
 * "Authorize" in the browser, the backend associates their API key with
 * the session_id. This CLI polls the backend with {session_id, code_verifier}
 * and receives the API key when the authorization completes.
 */

import open from "open";
import { generateSessionId, generateVerifier, generateChallenge } from "./pkce.js";
import { WEB_URL, CLI_STATUS_URL } from "../util/constants.js";

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;

export async function browserLogin({ webUrl = WEB_URL, statusUrl = CLI_STATUS_URL } = {}) {
  const sessionId = generateSessionId();
  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);

  const loginUrl = `${webUrl}/cli-auth?code_challenge=${challenge}#session_id=${sessionId}`;

  process.stderr.write(`\nOpening browser for authentication...\n`);
  process.stderr.write(`If the browser doesn't open, visit:\n  ${loginUrl}\n\n`);

  try {
    await open(loginUrl);
  } catch {
    // fallback instructions already printed above
  }

  return await pollForAuth({ sessionId, verifier, statusUrl });
}

async function pollForAuth({ sessionId, verifier, statusUrl }) {
  const start = Date.now();
  let dots = 0;
  const isTTY = process.stderr.isTTY;

  while (Date.now() - start < TIMEOUT_MS) {
    if (isTTY) {
      process.stderr.write(`\rWaiting for browser authentication${".".repeat(dots % 4).padEnd(3)} `);
      dots++;
    }

    const result = await pollOnce({ statusUrl, sessionId, verifier });
    if (result) {
      if (isTTY) process.stderr.write("\r" + " ".repeat(50) + "\r");
      return result;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("Authentication timed out. Please try again.");
}

async function pollOnce({ statusUrl, sessionId, verifier }) {
  try {
    const res = await fetch(statusUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, code_verifier: verifier }),
    });
    if (res.status === 202) return null; // pending
    if (res.status === 401) throw new Error("Authentication rejected. Start login over.");
    if (!res.ok) return null; // transient, keep polling
    const data = await res.json();
    if (data && data.apiKey) return data;
    return null;
  } catch (err) {
    // Network errors: transient, keep polling. Explicit 401 rethrows above.
    if (err.message?.startsWith("Authentication rejected")) throw err;
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
