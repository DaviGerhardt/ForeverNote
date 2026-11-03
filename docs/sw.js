const CACHE = "forevernote-v1";
const ASSETS = ["./","index.html","app.js","supabase.js","styles.css","manifest.webmanifest","icon.png","icon-192.png","icon-512.png","icon-maskable.png","fonts/Lora.ttf","fonts/Lora-Italic.ttf","fonts/RobotoSlab.ttf","fonts/DancingScript.ttf","fonts/Caveat.ttf"];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {}))); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
  );
});
