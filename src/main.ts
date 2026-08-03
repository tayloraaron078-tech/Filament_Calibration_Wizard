import './styles.css';
import { startApp } from './app';
import { hydrateSettingsFromServer } from './storage/store';
import { setStoredToken } from './storage/serverBridge';
import { captureTokenFromUrl } from './storage/tokenCapture';

/**
 * A self-hosted deployment can hand a user a one-time `?token=...` link
 * carrying their PERFECTFIT_API_TOKEN. Captured into localStorage and
 * stripped from the URL immediately (before hydrateSettingsFromServer() so
 * the freshly-captured token is used on the very first backend call, not
 * just saved for next time) so it never lingers in history/bookmarks/Referer.
 */
function captureTokenFromLocation(): void {
  const { token, strippedUrl } = captureTokenFromUrl(location.href);
  if (!token) return;
  setStoredToken(token);
  history.replaceState(null, '', strippedUrl);
}

async function bootstrap(): Promise<void> {
  captureTokenFromLocation();

  // Must resolve before startApp()'s first synchronous loadSettings() call so
  // server-side settings (if any backend is configured) win over stale local
  // ones on load. No-op — resolves promptly — when no backend is reachable.
  await hydrateSettingsFromServer();

  try {
    startApp();
  } catch (err) {
    const root = document.getElementById('app');
    if (root) {
      const main = document.createElement('main');
      main.className = 'startup-error';
      main.setAttribute('style', 'padding:2rem;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif');

      const title = document.createElement('h1');
      title.textContent = 'PerfectFit could not start';
      const body = document.createElement('p');
      body.textContent = 'The app window opened, but startup failed before the wizard could render.';
      const detail = document.createElement('pre');
      detail.setAttribute('style', 'white-space:pre-wrap;background:#fff3cd;border:1px solid #ffe69c;border-radius:8px;padding:1rem');
      detail.textContent = String(err);

      main.append(title, body, detail);
      root.replaceChildren(main);
    }
    console.error('PerfectFit startup failed', err);
  }
}

void bootstrap();

// PWA service worker — for real web deployments only. Inside Tauri the app is
// served from disk, so a service worker adds nothing and a cache-first one is
// actively dangerous: after an update it keeps serving the previous version's
// index.html, whose hashed bundle no longer exists, wedging the app on the
// static loading screen. In Tauri we therefore unregister any worker left by
// an older version and drop its caches (user data in IndexedDB/localStorage is
// unaffected).
const isTauri = '__TAURI_INTERNALS__' in window || location.hostname === 'tauri.localhost';
if ('serviceWorker' in navigator) {
  if (isTauri) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => { r.unregister().catch(() => {}); }))
      .catch(() => {});
    if (typeof caches !== 'undefined') {
      caches.keys().then((keys) => keys.forEach((k) => { caches.delete(k).catch(() => {}); })).catch(() => {});
    }
  } else if (location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline install is optional */ });
    });
  }
}
