/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const cacheName = "git-review-shell-v1";
const cachePrefix = "git-review-shell-";
const offlinePath = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.add(offlinePath)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith(cachePrefix) && name !== cacheName).map((name) => caches.delete(name)))),
    self.clients.claim(),
  ]).then(() => undefined));
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(async () => await caches.match(offlinePath) ?? Response.error()));
});
