const CACHE = "daguan-shell-v67";
const SHELL = [
  "./",
  "./landing.html",
  "./landing.css?v=3",
  "./landing.js?v=2",
  "./assets/landing/daguan-curve-logo.png",
  "./assets/landing/landing-book-particles.jpg",
  "./assets/landing/wechat_qrcode.png",
  "./index.html",
  "./styles.css?v=48",
  "./app2.js?v=31",
  "./vendor/marked.min.js",
  "./vendor/katex.min.js",
  "./vendor/katex.min.css",
  "./data/manifest.json",
  "./data/categories.json",
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
