/* Frenz service worker — Web Push receiver + PWA runtime cache.
 *
 * Caching strategy (native-app feel + offline shell):
 *  - Immutable build assets (/_next/static, fonts) → cache-first (instant repeat loads).
 *  - Images (thumbnails/avatars) → stale-while-revalidate, capped cache.
 *  - Navigations (HTML) → network-first with a cached fallback, then an offline page.
 *  - Everything else (API, realtime, POST) → straight to network (never cached).
 */

const VERSION = "v3";
const STATIC_CACHE = `frenz-static-${VERSION}`;
const IMAGE_CACHE = `frenz-img-${VERSION}`;
const PAGE_CACHE = `frenz-pages-${VERSION}`;
const KEEP = [STATIC_CACHE, IMAGE_CACHE, PAGE_CACHE];
const IMAGE_MAX = 80;

const OFFLINE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Frenz</title><style>html,body{height:100%;margin:0;background:#080b14;color:#e5e7eb;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}div{padding:2rem}h1{font-size:1.25rem;margin:.5rem 0}p{color:#9ca3af;font-size:.9rem}</style></head><body><div><h1>You’re offline</h1><p>Check your connection — Frenz will be right back.</p></div></body></html>';

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  const isStatic =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/"));
  const isFont = /\.(woff2?|ttf|otf)$/i.test(url.pathname);
  const isImage = req.destination === "image" || /\.(avif|webp|png|jpe?g|gif|svg|ico)$/i.test(url.pathname);

  // Immutable, hashed assets — cache-first (they never change under the same URL).
  if (isStatic || isFont) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Images — stale-while-revalidate.
  if (isImage) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok || res.type === "opaque") {
              cache.put(req, res.clone());
              trimCache(IMAGE_CACHE, IMAGE_MAX);
            }
            return res;
          })
          .catch(() => hit);
        return hit || network;
      }),
    );
    return;
  }

  // Navigations — network-first, fall back to the last cached page, then offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok && url.origin === self.location.origin) {
            const cache = await caches.open(PAGE_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch {
          const cached = await caches.match(req);
          return cached || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
      })(),
    );
    return;
  }

  // Everything else (API, realtime, etc.) — untouched, straight to network.
});

/* ── Web Push ─────────────────────────────────────────────────────────────── */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Frenz", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Frenz";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon.png",
    badge: "/icon.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/home" },
    vibrate: [60, 30, 60],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/home";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
