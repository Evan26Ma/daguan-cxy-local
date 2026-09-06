const CACHE = "daguan-shell-v5";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js?v=4",
  "./vendor/marked.min.js",
  "./vendor/katex.min.js",
  "./vendor/katex.min.css",
  "./data/manifest.json",
  "./data/categories.json",
  "./data/category_questions.json",
  "./data/id_index.json",
  "./data/search_index.json",
  "./vendor/fonts/KaTeX_AMS-Regular.ttf",
  "./vendor/fonts/KaTeX_AMS-Regular.woff",
  "./vendor/fonts/KaTeX_AMS-Regular.woff2",
  "./vendor/fonts/KaTeX_Caligraphic-Bold.ttf",
  "./vendor/fonts/KaTeX_Caligraphic-Bold.woff",
  "./vendor/fonts/KaTeX_Caligraphic-Bold.woff2",
  "./vendor/fonts/KaTeX_Caligraphic-Regular.ttf",
  "./vendor/fonts/KaTeX_Caligraphic-Regular.woff",
  "./vendor/fonts/KaTeX_Caligraphic-Regular.woff2",
  "./vendor/fonts/KaTeX_Fraktur-Bold.ttf",
  "./vendor/fonts/KaTeX_Fraktur-Bold.woff",
  "./vendor/fonts/KaTeX_Fraktur-Bold.woff2",
  "./vendor/fonts/KaTeX_Fraktur-Regular.ttf",
  "./vendor/fonts/KaTeX_Fraktur-Regular.woff",
  "./vendor/fonts/KaTeX_Fraktur-Regular.woff2",
  "./vendor/fonts/KaTeX_Main-Bold.ttf",
  "./vendor/fonts/KaTeX_Main-Bold.woff",
  "./vendor/fonts/KaTeX_Main-Bold.woff2",
  "./vendor/fonts/KaTeX_Main-BoldItalic.ttf",
  "./vendor/fonts/KaTeX_Main-BoldItalic.woff",
  "./vendor/fonts/KaTeX_Main-BoldItalic.woff2",
  "./vendor/fonts/KaTeX_Main-Italic.ttf",
  "./vendor/fonts/KaTeX_Main-Italic.woff",
  "./vendor/fonts/KaTeX_Main-Italic.woff2",
  "./vendor/fonts/KaTeX_Main-Regular.ttf",
  "./vendor/fonts/KaTeX_Main-Regular.woff",
  "./vendor/fonts/KaTeX_Main-Regular.woff2",
  "./vendor/fonts/KaTeX_Math-BoldItalic.ttf",
  "./vendor/fonts/KaTeX_Math-BoldItalic.woff",
  "./vendor/fonts/KaTeX_Math-BoldItalic.woff2",
  "./vendor/fonts/KaTeX_Math-Italic.ttf",
  "./vendor/fonts/KaTeX_Math-Italic.woff",
  "./vendor/fonts/KaTeX_Math-Italic.woff2",
  "./vendor/fonts/KaTeX_SansSerif-Bold.ttf",
  "./vendor/fonts/KaTeX_SansSerif-Bold.woff",
  "./vendor/fonts/KaTeX_SansSerif-Bold.woff2",
  "./vendor/fonts/KaTeX_SansSerif-Italic.ttf",
  "./vendor/fonts/KaTeX_SansSerif-Italic.woff",
  "./vendor/fonts/KaTeX_SansSerif-Italic.woff2",
  "./vendor/fonts/KaTeX_SansSerif-Regular.ttf",
  "./vendor/fonts/KaTeX_SansSerif-Regular.woff",
  "./vendor/fonts/KaTeX_SansSerif-Regular.woff2",
  "./vendor/fonts/KaTeX_Script-Regular.ttf",
  "./vendor/fonts/KaTeX_Script-Regular.woff",
  "./vendor/fonts/KaTeX_Script-Regular.woff2",
  "./vendor/fonts/KaTeX_Size1-Regular.ttf",
  "./vendor/fonts/KaTeX_Size1-Regular.woff",
  "./vendor/fonts/KaTeX_Size1-Regular.woff2",
  "./vendor/fonts/KaTeX_Size2-Regular.ttf",
  "./vendor/fonts/KaTeX_Size2-Regular.woff",
  "./vendor/fonts/KaTeX_Size2-Regular.woff2",
  "./vendor/fonts/KaTeX_Size3-Regular.ttf",
  "./vendor/fonts/KaTeX_Size3-Regular.woff",
  "./vendor/fonts/KaTeX_Size3-Regular.woff2",
  "./vendor/fonts/KaTeX_Size4-Regular.ttf",
  "./vendor/fonts/KaTeX_Size4-Regular.woff",
  "./vendor/fonts/KaTeX_Size4-Regular.woff2",
  "./vendor/fonts/KaTeX_Typewriter-Regular.ttf",
  "./vendor/fonts/KaTeX_Typewriter-Regular.woff",
  "./vendor/fonts/KaTeX_Typewriter-Regular.woff2",
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
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && new URL(request.url).origin === location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
