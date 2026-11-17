// Weigh-In service worker: makes the app open instantly and keep working with no signal.
//
// How it decides:
//   The app's own code (page, app.js, sw.js) -> try the internet first, fall back to the saved copy.
//     That way a new version always wins when you have signal, and you still get in when you don't.
//   Pictures, icons and fonts -> use the saved copy first, since they almost never change.
//   Everything else (Firebase, maps, photos people post) -> straight through, never saved.
const CACHE = "weighin-shell-v3";
const SHELL = ["./", "./index.html", "./sw.js", "./app.js", "./bobber-192.png", "./bobber-180.png", "./manifest.webmanifest"];
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
    await Promise.all(keys.filter((k) => k.startsWith("weighin-") && k !== CACHE).map((k) => caches.delete(k)));
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
  if (sdk) { e.respondWith(cacheFirst(req)); return; }
  if (fonts || (sameSite && /\.(png|jpg|jpeg|webp|svg|ico|webmanifest)$/.test(url.pathname))) {
    e.respondWith(cacheFirst(req).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  // Firebase, maps, posted photos and everything else: never saved, so they are always live.
});

// The app can ask for the saved copies to be thrown away (Settings has a "Fix the app" button).
self.addEventListener("message", (e) => {
  if (e.data === "weighin-clear") {
    e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))));
  }
});
