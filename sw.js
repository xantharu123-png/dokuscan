// Service Worker: hält die App offline verfügbar.
// Große Bibliotheken kommen aus dem Cache, alles andere bevorzugt frisch aus dem Netz.

const CACHE = 'dokuscan-v3';
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/camera.js',
  './js/cv-loader.js',
  './js/detect.js',
  './js/editor.js',
  './js/geometry.js',
  './js/pdf.js',
  './js/placement.js',
  './js/process.js',
  './js/signature.js',
  './vendor/opencv.js',
  './vendor/jspdf.umd.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  if (/\/(vendor|icons)\//.test(request.url)) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
