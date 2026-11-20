// Weigh-In service worker: makes the app open instantly and keep working with no signal.
//
// How it decides:
//   The app's own code (page, app.js, style.css) -> try the internet first, fall back to the saved copy.
//     That way a new version always wins when you have signal, and you still get in when you don't.
//   Pictures, icons and fonts -> use the saved copy first, since they almost never change.
//   Catch photos (/api/photo) -> saved copy first, since a photo never changes.
//   Everything else (Firebase, maps) -> straight through, never saved.
const CACHE = "weighin-shell-v3";
const PHOTOS = "weighin-photos-v1";   // catch photos you have looked at, so they show again with no signal
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./bobber-192.png", "./bobber-180.png", "./manifest.webmanifest"];
// Firebase's own code. Saved on the first visit so the app can start with no signal from then on.
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const SDK = [FB + "firebase-app.js", FB + "firebase-auth.js", FB + "firebase-firestore.js"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // One bad file must not stop the rest from being saved.
    await Promise.allSettled([
      ...SHELL.map((u) => c.add(new Request(u, { cache: "reload" }))),
      ...SDK.map((u) => c.add(new Request(u, { mode: "cors" })))
    ]);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("weighin-") && k !== CACHE && k !== PHOTOS).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// app.js?v=76 and app.js?v=77 are the same file, so they share one saved copy.
function key(url) {
  const u = new URL(url);
  if (/\.(js|css|html)$/.test(u.pathname)) u.search = "";
  return u.toString();
}

async function netFirst(req) {
  const k = key(req.url);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) { const c = await caches.open(CACHE); c.put(k, fresh.clone()); }
    return fresh;
  } catch (err) {
    const hit = await caches.match(k) || await caches.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const fresh = await fetch(req);
  if (fresh && fresh.ok) { const c = await caches.open(CACHE); c.put(req, fresh.clone()); }
  return fresh;
}

// A catch photo's link is its name and a photo never changes, so a saved copy is always right.
// Keep the newest 150 so this never fills the phone.
async function photoFirst(req) {
  const c = await caches.open(PHOTOS);
  const hit = await c.match(req);
  if (hit) return hit;
  const fresh = await fetch(req);
  if (fresh && fresh.status === 200) {
    c.put(req, fresh.clone()).then(async () => {
      const ks = await c.keys();
      if (ks.length > 150) await Promise.all(ks.slice(0, ks.length - 150).map((k) => c.delete(k)));
    }).catch(() => {});
  }
  return fresh;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  const sameSite = url.origin === self.location.origin;
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  // Firebase's own code never changes for a given version number, so keep it. Without it the app
  // cannot even start with no signal.
  const sdk = url.hostname === "www.gstatic.com" && url.pathname.includes("/firebasejs/");

  // The page itself: internet first, saved copy if there is no signal.
  if (req.mode === "navigate") {
    e.respondWith(netFirst(req).catch(() => caches.match("./index.html") || caches.match("./")));
    return;
  }
  if (sameSite && /\.(js|css)$/.test(url.pathname)) { e.respondWith(netFirst(req)); return; }
  if (sameSite && url.pathname === "/api/photo" && url.searchParams.has("id")) { e.respondWith(photoFirst(req)); return; }
  if (sdk) { e.respondWith(cacheFirst(req)); return; }
  if (fonts || (sameSite && /\.(png|jpg|jpeg|webp|svg|ico|webmanifest)$/.test(url.pathname))) {
    e.respondWith(cacheFirst(req).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  // Firebase, maps and everything else: never saved, so they are always live.
});

// The app can ask for the saved copies to be thrown away (Settings has a "Fix the app" button).
self.addEventListener("message", (e) => {
  if (e.data === "weighin-clear") {
    e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))));
  }
});

// Notifications from friends (sent by functions/api/push.js). Shown even when Weigh-In is closed.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* plain text */ }
  e.waitUntil((async () => {
    // If Weigh-In is open and on screen, the feed already shows the new catch, so no pop-up.
    const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (cs.some((c) => c.visibilityState === "visible")) return;
    await self.registration.showNotification(String(d.t || "Weigh-In").slice(0, 80), {
      body: String(d.b || "").slice(0, 140), icon: "./bobber-192.png", badge: "./bobber-192.png", tag: d.tag || "weighin", renotify: true,
      data: { u: typeof d.u === "string" && d.u.startsWith("/") ? d.u : "/" },
    });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const u = (e.notification.data && e.notification.data.u) || "/";
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of cs) { if ("focus" in c) { try { await c.focus(); return; } catch { /* try next */ } } }
    await self.clients.openWindow(u);
  })());
});
