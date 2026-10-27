// Stillpoint service worker
// - Network-first for the app shell so updates show up immediately; cache is the offline fallback.
// - "Quote of the day": woken by Periodic Background Sync (installed apps on Chrome/Edge),
//   it picks a quote with the same preference model as the app and shows a notification.
const CACHE = "stillpoint-v10";
const SHELL = ["./", "index.html", "css/styles.css", "js/app.js", "js/picker.js", "js/quotes.js", "js/backgrounds.js", "manifest.webmanifest", "icons/icon.svg"];

self.window = self; // quotes.js assigns window.QUOTES
importScripts("js/quotes.js", "js/picker.js");
const P = self.StillpointPicker;
const QUOTES = self.QUOTES.map((q) => ({ ...q, id: P.hash(q.t) }));
const EARLIEST_HOUR = 7; // don't notify before 7am local time

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // let the browser stream audio itself (range requests can't be cached here)
  if (url.pathname.includes("/audio/") || e.request.headers.has("range")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});

function localDay(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function quoteOfTheDay(force) {
  const now = new Date();
  const today = localDay(now);
  if (!force) {
    if ((await P.kvGet("qotdDay")) === today) return; // already sent today
    if (now.getHours() < EARLIEST_HOUR) return;       // too early; a later wake-up will send it
  }
  const prefs = (await P.kvGet("prefs")) || {};
  const sent = (await P.kvGet("qotdHistory")) || [];
  // never repeat a recent daily quote, and don't resend ones already on your wall
  const exclude = new Set([...sent, ...(prefs.favorites || [])]);
  const q = P.pick(QUOTES, prefs, exclude);
  await self.registration.showNotification("Quote of the day", {
    body: `“${q.t}” — ${q.a}`,
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: "qotd",
    data: { id: q.id },
  });
  await P.kvSet("qotdDay", today);
  await P.kvSet("qotdHistory", [...sent, q.id].slice(-120));
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "qotd") e.waitUntil(quoteOfTheDay(false));
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "qotd-now") e.waitUntil(quoteOfTheDay(true));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) {
      const w = wins[0];
      await w.focus();
      if (id) w.postMessage({ type: "show-quote", id });
      return;
    }
    const url = new URL(id ? `./?q=${encodeURIComponent(id)}` : "./", self.registration.scope);
    await self.clients.openWindow(url.href);
  })());
});
