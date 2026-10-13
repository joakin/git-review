/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;
declare const __GIT_REVIEW_OFFLINE_VERSION__: string;

const scope = new URL(self.registration.scope);
const cachePrefix = `git-review-shell-${encodeURIComponent(scope.pathname)}-`;
const offlineVersion =
  typeof __GIT_REVIEW_OFFLINE_VERSION__ === "undefined" ? "v2" : __GIT_REVIEW_OFFLINE_VERSION__;
const cacheName = `${cachePrefix}${offlineVersion}`;
const offlinePath = new URL("offline.html", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.add(new Request(offlinePath, { cache: "no-store" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter(
                (name) =>
                  (name.startsWith(cachePrefix) && name !== cacheName) ||
                  (scope.pathname === "/" && name === "git-review-shell-v1"),
              )
              .map((name) => caches.delete(name)),
          ),
        ),
      self.clients.claim(),
    ]).then(() => undefined),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.mode !== "navigate" ||
    url.origin !== self.location.origin ||
    (url.pathname !== scope.pathname && url.pathname !== `${scope.pathname}index.html`)
  )
    return;
  event.respondWith(
    fetch(event.request, { cache: "no-store" }).catch(async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(offlinePath)) ?? Response.error();
    }),
  );
});
