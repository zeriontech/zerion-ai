/**
 * PKCE primitives for the CLI browser login flow.
 *
 * - sessionId: opaque correlation ID placed in the URL fragment so the
 *   backend can route the approval to the right polling CLI.
 * - verifier: random secret held only by the CLI; sent to the backend
 *   alongside its hash to prove the polling client is the same one that
 *   initiated the flow.
 * - challenge: sha256(verifier) in base64url, sent to the browser so the
 *   backend can compare against the verifier later.
 */

import crypto from "node:crypto";

export function generateSessionId() {
  return crypto.randomBytes(32).toString("hex"); // 64 hex chars
}

export function generateVerifier() {
  return crypto.randomBytes(32).toString("base64url"); // 43 chars
}

export function generateChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url"); // 43 chars
}
