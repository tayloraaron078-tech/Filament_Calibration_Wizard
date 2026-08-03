// ---------------------------------------------------------------------------
// Tracks which of three states the app is in with respect to the optional
// self-hosted server, beyond serverBridge.ts's plain reachable/unreachable
// signal:
//
//   'no-backend'  — no server responds to the health check (today's default).
//   'connected'   — server reachable and a data call succeeded (either no
//                   token is configured server-side, or a stored token works).
//   'needs-token' — server reachable but a data call came back 401: a token
//                   is required and the one stored (if any) is missing/wrong.
//
// There is no dedicated "is auth enabled" endpoint (see server/auth.ts), so
// this is inferred empirically from the outcome of the settings hydration
// call store.ts already makes at startup. Exposed the same way
// serverBridge.ts exposes isBackendReadySync(): a memoized module-level
// value written by hydrateSettingsFromServer()/reconnect flows, read
// synchronously by UI that renders after bootstrap.
// ---------------------------------------------------------------------------

export type ConnectionState = 'no-backend' | 'connected' | 'needs-token';

let state: ConnectionState = 'no-backend';

/** Synchronous read of the last-determined connection state. */
export function getConnectionState(): ConnectionState {
  return state;
}

export function setConnectionState(next: ConnectionState): void {
  state = next;
}

/**
 * Pure decision logic, extracted so the three-state outcome is testable
 * without touching fetch/localStorage. `healthOk` mirrors serverBridge's
 * backendReady(); `authFailed` should be true only when a data call came
 * back 401 specifically (not any other error, which leaves connectivity
 * ambiguous and is treated as 'connected' — the server IS reachable, the
 * failure is presumed transient/unrelated to auth).
 */
export function deriveConnectionState(opts: { healthOk: boolean; authFailed: boolean }): ConnectionState {
  if (!opts.healthOk) return 'no-backend';
  return opts.authFailed ? 'needs-token' : 'connected';
}
