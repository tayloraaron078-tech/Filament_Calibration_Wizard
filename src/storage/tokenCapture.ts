// ---------------------------------------------------------------------------
// Pure logic for the `?token=xxxx` onboarding flow: a self-hosted deployment
// can hand a user a one-time link (e.g. from the container's admin) that
// carries their PERFECTFIT_API_TOKEN. main.ts's bootstrap() captures it into
// localStorage and strips it from the URL immediately, so it never lingers
// in browser history, bookmarks, or gets leaked via a Referer header.
//
// Kept DOM/location-free so it's testable with plain URL strings — see
// eraseEverything.ts for the same "extract pure logic, test that" pattern.
// ---------------------------------------------------------------------------

export interface TokenCaptureResult {
  /** The captured token, or null if the URL carried no `token` query param. */
  token: string | null;
  /** `url` with the `token` param removed (query string dropped entirely if now empty). Unchanged when token is null. */
  strippedUrl: string;
}

export function captureTokenFromUrl(url: string): TokenCaptureResult {
  const u = new URL(url);
  const token = u.searchParams.get('token');
  if (token === null) return { token: null, strippedUrl: url };

  u.searchParams.delete('token');
  const search = u.searchParams.toString();
  const strippedUrl = `${u.origin}${u.pathname}${search ? `?${search}` : ''}${u.hash}`;
  return { token, strippedUrl };
}
