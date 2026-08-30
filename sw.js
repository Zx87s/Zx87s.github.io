"use strict";

const CACHE_NAME = "zx87s-public-v27";
const CORE_ASSETS = ["./", "./index.html", "./styles.css?v=27", "./app.js?v=27", "./favicon.svg"];
const API_ORIGIN = "https://ta3reebat-memberships.zx87s.chatgpt.site";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE_ASSETS.map((asset) => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("zx87s-public-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function cacheable(response) {
  return response && (response.ok || response.type === "opaque");
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request).then((response) => cacheable(response) && cache.put(request, response.clone())).catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    if (cacheable(response)) await cache.put(request, response.clone());
    return response;
  });
  return cached || network;
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (cacheable(response)) (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match("./index.html")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("Authorization")) return;
  const url = new URL(request.url);
  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }
  const publicImage = request.destination === "image";
  const staticAsset = url.origin === self.location.origin && /\.(?:css|js|svg|webp|png|jpe?g|gif|woff2?)$/i.test(url.pathname);
  if (publicImage || staticAsset) {
    event.respondWith(cacheFirst(request));
    return;
  }
  const publicApi = url.origin === API_ORIGIN && (
    url.pathname === "/api/bootstrap"
    || url.pathname === "/api/news"
    || url.pathname === "/api/site-settings"
    || url.pathname === "/api/translations"
    || url.pathname.startsWith("/api/media/")
  );
  if (publicApi) event.respondWith(staleWhileRevalidate(request));
});
