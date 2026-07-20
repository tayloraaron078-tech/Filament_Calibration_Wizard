import './styles.css';
import { startApp } from './app';

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
