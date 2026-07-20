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

// PWA: register the service worker (only over http(s); harmless if it fails).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline install is optional */ });
  });
}
