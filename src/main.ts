import './styles.css';
import { startApp } from './app';

startApp();

// PWA: register the service worker (only over http(s); harmless if it fails).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline install is optional */ });
  });
}
