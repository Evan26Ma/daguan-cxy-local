const CACHE = "daguan-shell-v116";
const SHELL = [
  "./",
  "./landing.html",
  "./landing.css?v=7",
  "./design-tokens.css?v=2",
  "./design-tokens.css?v=3",
  "./landing.js?v=3",
  "./assets/landing/local-mark.svg",
  "./assets/math-mark.svg",
  "./assets/landing/math-surface.svg",
  "./assets/landing/daguan-curve-logo.png",
  "./index.html",
  "./ui-version.js?v=106",
  "./legacy.html",
  "./legacy.css?v=89",
  "./app-legacy.js?v=91",
  "./styles.css?v=89",
  "./app2.js?v=90",
  "./styles-new.css?v=110",
  "./app-new.js?v=113",
  "./vendor/marked.min.js",
  "./vendor/katex.min.js",
  "./vendor/katex.min.css",
  "./data/manifest.json",
  "./data/categories.json",
  "./data/paradiyu-linear-video.json",
  "./data/lecture-video-mappings.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("daguan-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).pathname.includes("/api/")) return;
  const isNavigation = request.mode === "navigate" || request.destination === "document";
  event.respondWith(
    isNavigation
      ? fetch(request).then((response) => {
          if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
          return response;
        }).catch(() => caches.match(request).then((cached) => cached || caches.match(new URL(request.url).pathname.endsWith("legacy.html") ? "./legacy.html" : "./index.html")))
      : caches.match(request).then((cached) => cached || fetch(request).then((response) => {
          if (response.ok && new URL(request.url).origin === location.origin) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
          return response;
        }))
  );
});
