/**
 * Dosage Calculator service worker: a small hand-written cache-first app
 * shell (PLAN.md §6). No dependencies, relative paths only — GitHub Pages
 * serves project sites from /<repo>/, so the registration scope "./" puts
 * the worker in charge of exactly this app's subtree.
 *
 * IMPORTANT: this is a cache-first shell. When you change any app asset,
 * bump CACHE_VERSION below — otherwise installed clients keep serving the
 * previously cached files. (See the AGENTS.md toolchain notes.)
 */
const CACHE_VERSION = 'v2';
const CACHE_NAME = `dosage-calculator-${CACHE_VERSION}`;

/** Relative, scope-rooted precache list: the whole app shell. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/main.css',
  './src/js/main.js',
  './src/js/ui/calculator.js',
  './src/js/ui/presets.js',
  './src/js/ui/history.js',
  './src/js/ui/settings.js',
  './src/js/lib/calc.js',
  './src/js/lib/storage.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache belonging to an older app version.
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Privacy by design (PLAN.md §1): only ever touch same-origin requests —
  // third-party traffic passes through untouched.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      try {
        const fresh = await fetch(request);
        if (request.mode === 'navigate') {
          // Unknown/dead paths get the app shell instead of a raw error
          // page (this is a single-page app with no routes). But the shell
          // uses relative asset URLs, which resolve against the *page* URL —
          // serving it from a deep path yields a broken, script-less shell.
          // Redirect unknown paths to the app root, where resolution is
          // correct; only serve the shell directly for the root itself.
          const rootPath = new URL('./', self.registration.scope).pathname;
          if (new URL(request.url).pathname !== rootPath) {
            return Response.redirect(new URL('./', self.registration.scope).href, 302);
          }
          if (!fresh.ok) {
            const shell = await caches.match('./index.html');
            if (shell) return shell;
          }
          return fresh;
        }
        // Opportunistically extend the runtime cache with same-origin GETs
        // (e.g. icons beyond the precache list). Errors and opaque responses
        // are not stored.
        if (fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (err) {
        // Offline navigation: deep/unknown paths redirect to the app root
        // (see the comment above); the root itself falls back to the cached
        // shell so the app always opens offline.
        if (request.mode === 'navigate') {
          const rootPath = new URL('./', self.registration.scope).pathname;
          if (new URL(request.url).pathname !== rootPath) {
            return Response.redirect(new URL('./', self.registration.scope).href, 302);
          }
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('Offline and not cached', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })(),
  );
});
