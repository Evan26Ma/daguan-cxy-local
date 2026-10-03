const CACHE = "daguan-shell-v149";
const SHELL = [
  "./",
  "./landing.html",
  "./landing.css?v=7",
  "./design-tokens.css?v=2",
  "./design-tokens.css?v=3",
  "./landing.js?v=3",
  "./assets/landing/local-mark.svg",
  "./assets/landing/local-mark.png",
  "./assets/math-mark.svg",
  "./assets/landing/math-surface.svg",
  "./assets/landing/daguan-curve-logo.png",
  "./index.html",
  "./ui-version.js?v=106",
  "./legacy.html",
  "./legacy.css?v=93",
  "./guides.css?v=2",
  "./app-legacy.js?v=109",
  "./styles.css?v=89",
  "./app2.js?v=91",
  "./styles-new.css?v=123",
  "./source-taxonomy.js?v=1",
  "./app-new.js?v=140",
  "./study-report.css?v=1",
  "./study-report.js?v=1",
  "./study-activity-client.js?v=2",
  "./study-journal.js?v=1",
  "./study-journal.css?v=1",
  "./ai-services.css?v=1",
  "./ai-settings.js?v=1",
  "./ai-panel-layout.js?v=3",
  "./ai-reading.js?v=2",
  "./section-celebration.js?v=1",
  "./choice-grading.js?v=1",
  "./visit-history-client.js?v=1",
  "./data-bank-client.js?v=1",
  "./browser-retirement.css?v=1",
  "./browser-retirement.js?v=1",
  "./vendor/purify.min.js",
  "./safe-render.js?v=1",
  "./new-data.js?v=2",
  "./new-state.js?v=1",
  "./new-ai.js?v=1",
  "./vendor/marked.min.js",
  "./vendor/katex.min.js",
  "./vendor/katex.min.css",
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
  if (new URL(request.url).pathname.includes("/api/") || new URL(request.url).pathname.includes("/data/")) return;
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
