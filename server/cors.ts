// CORS for the /api/v1/* surface. Phase 1-5 assumed same-origin (browser tab
// pointed straight at this server); phase 6 adds a client that is NOT
// same-origin (desktop app loading assets from tauri://, or a browser tab on
// a different host/port) — without CORS headers those cross-origin fetches
// are blocked by the browser before a response ever reaches app code.
//
// `Access-Control-Allow-Origin: *` is deliberately permissive but still
// correct here: this API's only credential is a bearer token the client
// attaches explicitly (Authorization header) — never a cookie or other
// ambient credential a browser would attach automatically. A malicious page
// on another origin can trigger a cross-origin request, but without the
// token it gets the same 401 any unauthenticated caller would; there is no
// session for it to ride along on. Wildcard + explicit-header auth is the
// standard safe pattern for token-authed APIs (contrast with cookie-authed
// APIs, where a wildcard origin would be a real vulnerability).
import type { IncomingMessage, ServerResponse } from 'node:http';

const ALLOWED_METHODS = 'GET, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type';

/** Sets CORS headers on every /api/v1/* response, preflight or real. */
export function applyCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
}

/**
 * Answers an OPTIONS preflight directly, with no auth/route-matching — the
 * browser sends preflight requests without the Authorization header it's
 * asking permission to send, so requiring a token here would make every
 * cross-origin request fail before the real one is even attempted.
 * Returns true when it handled the request (caller must not process it further).
 */
export function handlePreflight(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'OPTIONS') return false;
  res.writeHead(204);
  res.end();
  return true;
}
