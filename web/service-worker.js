const CACHE = "daguan-shell-v76";
const SHELL = [
  "./",
  "./landing.html",
  "./landing.css?v=5",
  "./landing.js?v=3",
  "./assets/landing/local-mark.svg",
  "./assets/landing/math-surface.svg",
  "./assets/landing/daguan-curve-logo.png",
  "./index.html",
  "./styles.css?v=58",
  "./app2.js?v=46",
  "./vendor/marked.min.js",
  "./vendor/katex.min.js",
  "./vendor/katex.min.css",
  "./data/manifest.json",
  "./data/categories.json",
  "./data/paradiyu-linear-video.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
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
        }).catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
      : caches.match(request).then((cached) => cached || fetch(request).then((response) => {
          if (response.ok && new URL(request.url).origin === location.origin) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
          return response;
        }))
  );
});
