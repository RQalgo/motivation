// Shared by the page (app.js) and the service worker (sw.js):
// quote ids, the preference-weighted picker, and a tiny IndexedDB key-value store
// (the service worker can't read localStorage, so preferences are mirrored here).
(function (root) {
  "use strict";

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const authorKey = (a) => a.replace(/^(Attributed to|Often attributed to)\s+/i, "").split(/[,(]/)[0].trim();

  // prefs: { tags: {tag: score}, authors: {name: score}, disliked: [id], seen: [id] }
  // exclude: Set of ids that must not be picked
  function weight(q, prefs, disliked, seen, exclude) {
    if (disliked.has(q.id) || exclude.has(q.id)) return 0;
    const tags = prefs.tags || {}, authors = prefs.authors || {};
    const tagScore = q.g.reduce((s, t) => s + (tags[t] || 0), 0) / q.g.length;
    const authorScore = authors[authorKey(q.a)] || 0;
    let w = Math.exp(0.55 * tagScore + 0.35 * authorScore);
    if (seen.has(q.id)) w *= 0.25; // prefer quotes you haven't seen yet
    return Math.max(w, 0.04);
  }

  function pick(quotes, prefs, exclude) {
    prefs = prefs || {};
    exclude = exclude || new Set();
    const disliked = new Set(prefs.disliked || []);
    const seen = new Set(prefs.seen || []);
    let pool = quotes.map((q) => [q, weight(q, prefs, disliked, seen, exclude)]).filter(([, w]) => w > 0);
    if (!pool.length) pool = quotes.filter((q) => !disliked.has(q.id)).map((q) => [q, 1]);
    if (!pool.length) pool = quotes.map((q) => [q, 1]);
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [q, w] of pool) { if ((r -= w) <= 0) return q; }
    return pool[pool.length - 1][0];
  }

  // ---- IndexedDB key-value store ----
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open("stillpoint", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function kvGet(key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const r = d.transaction("kv").objectStore("kv").get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function kvSet(key, value) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  root.StillpointPicker = { hash, clamp, authorKey, pick, kvGet, kvSet };
})(typeof window !== "undefined" ? window : self);
