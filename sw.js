const CACHE_VERSION = "v5";
const CACHE_NAME = `sipemban-cache-${CACHE_VERSION}`;
const RUNTIME_CACHE = `sipemban-runtime-${CACHE_VERSION}`;
const TILE_CACHE = `sipemban-tiles-${CACHE_VERSION}`;

const ASSETS = [
  "./",
  "./intro.html",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./sw.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.map((k) => {
            if (![CACHE_NAME, RUNTIME_CACHE, TILE_CACHE].includes(k)) {
              return caches.delete(k);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  return cached || (await fetchPromise);
}

async function htmlFallback(path) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(path);
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (res && res.ok) cache.put(path, res.clone());
    return res;
  } catch {
    return cached || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  const isNavigate =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isNavigate && url.origin === self.location.origin) {
    const isIntro =
      url.pathname === "/" ||
      url.pathname === "/intro.html" ||
      url.pathname.endsWith("/intro.html");

    event.respondWith(htmlFallback(isIntro ? "./intro.html" : "./index.html"));
    return;
  }

  const isOsmTile =
    url.hostname.includes("tile.openstreetmap.org") ||
    url.hostname.endsWith(".tile.openstreetmap.org");

  if (isOsmTile) {
    event.respondWith(cacheFirst(req, TILE_CACHE));
    return;
  }

  const isLeafletCdn =
    url.hostname.includes("unpkg.com") && url.pathname.includes("/leaflet@");

  if (isLeafletCdn) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  event.respondWith(fetch(req).catch(() => caches.match(req)));
});
