// Minimal service worker so phones offer "Install app" / "Add to Home Screen".
// It does not cache anything, so you always get the newest version you uploaded.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
