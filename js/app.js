(function () {
  "use strict";

  // ---------- Data ----------
  const QUOTES = window.QUOTES.map((q) => ({ ...q, id: hash(q.t) }));
  const BY_ID = new Map(QUOTES.map((q) => [q.id, q]));
  const BG = window.BACKGROUNDS.slice();
  const badBg = new Set();

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  // ---------- Storage (best-effort) ----------
  const KEY = "stillpoint.v1";
  const defaults = () => ({ tags: {}, authors: {}, liked: [], disliked: [], favorites: [], seen: [], bgSeen: [] });
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(defaults(), JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---------- Preference model ----------
  // Each like nudges the quote's themes and author up; each dislike nudges them down.
  // Selection is weighted-random so new themes still appear (exploration).
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const authorKey = (a) => a.replace(/^(Attributed to|Often attributed to)\s+/i, "").split(/[,(]/)[0].trim();

  function adjust(q, delta) {
    q.g.forEach((tag) => { state.tags[tag] = clamp((state.tags[tag] || 0) + delta, -5, 5); });
    const ak = authorKey(q.a);
    state.authors[ak] = clamp((state.authors[ak] || 0) + delta * 0.6, -3, 3);
  }

  function weight(q, recent) {
    if (state.disliked.includes(q.id)) return 0;
    if (recent.has(q.id)) return 0;
    const tagScore = q.g.reduce((s, t) => s + (state.tags[t] || 0), 0) / q.g.length;
    const authorScore = state.authors[authorKey(q.a)] || 0;
    let w = Math.exp(0.55 * tagScore + 0.35 * authorScore);
    if (state.seen.includes(q.id)) w *= 0.25; // prefer unseen quotes
    return Math.max(w, 0.04);
  }

  function pickQuote() {
    const recentWindow = Math.min(40, Math.floor(QUOTES.length / 3));
    const recent = new Set(history.slice(-recentWindow).map((h) => h.id));
    let pool = QUOTES.map((q) => [q, weight(q, recent)]).filter(([, w]) => w > 0);
    if (!pool.length) pool = QUOTES.filter((q) => !state.disliked.includes(q.id)).map((q) => [q, 1]);
    if (!pool.length) pool = QUOTES.map((q) => [q, 1]);
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [q, w] of pool) { if ((r -= w) <= 0) return q; }
    return pool[pool.length - 1][0];
  }

  function pickBg() {
    const usable = BG.filter((id) => !badBg.has(id));
    const avoid = new Set(state.bgSeen.slice(-Math.floor(usable.length * 0.6)));
    const choices = usable.filter((id) => !avoid.has(id));
    const list = choices.length ? choices : usable;
    const id = list[Math.floor(Math.random() * list.length)];
    state.bgSeen.push(id);
    state.bgSeen = state.bgSeen.slice(-BG.length);
    return id;
  }

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    stage: $("stage"), quote: $("quote"), text: $("quoteText"), author: $("quoteAuthor"),
    bgA: $("bgA"), bgB: $("bgB"),
    prev: $("prevBtn"), next: $("nextBtn"),
    like: $("likeBtn"), dislike: $("dislikeBtn"), fav: $("favBtn"),
    music: $("musicBtn"), favCount: $("favCount"), openWall: $("openWall"),
    wall: $("wall"), closeWall: $("closeWall"), board: $("board"), wallSub: $("wallSub"),
    toast: $("toast"), hint: $("hint"),
  };

  // ---------- Backgrounds ----------
  // Requested photo size, rounded to 200px steps so the cache is reused.
  // Falls back to the screen size when the window has no size yet (hidden tab or pane).
  function viewSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth || document.documentElement.clientWidth || screen.width || 1280;
    const vh = window.innerHeight || document.documentElement.clientHeight || screen.height || 800;
    const step = (v) => Math.max(600, Math.min(2400, Math.ceil((v * dpr) / 200) * 200));
    return { w: step(vw), h: step(vh) };
  }
  let reqSize = viewSize();
  function bgUrl(id) {
    return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&crop=entropy&w=${reqSize.w}&h=${reqSize.h}&q=78`;
  }
  const preloaded = new Map();
  function loadImage(id) {
    if (preloaded.has(id)) return preloaded.get(id);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img.src);
      img.onerror = () => reject(id);
      img.src = bgUrl(id);
    });
    preloaded.set(id, p);
    return p;
  }

  let frontLayer = el.bgA;
  let bgToken = 0;
  async function showBg(entry) {
    const token = ++bgToken;
    let src;
    for (let tries = 0; tries < 4; tries++) {
      try { src = await loadImage(entry.bg); break; }
      catch (badId) {
        badBg.add(badId);
        preloaded.delete(badId);
        entry.bg = pickBg();
      }
    }
    if (!src || token !== bgToken) return;
    const back = frontLayer === el.bgA ? el.bgB : el.bgA;
    back.style.backgroundImage = `url("${src}")`;
    back.classList.remove("show");
    void back.offsetWidth; // restart drift animation
    back.classList.add("show");
    frontLayer.classList.remove("show");
    frontLayer = back;
  }

  // If the window grows or changes shape a lot (rotation, pane opened), refetch at the new size.
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const next = viewSize();
      const ratioOld = reqSize.w / reqSize.h, ratioNew = next.w / next.h;
      if (next.w > reqSize.w * 1.3 || next.h > reqSize.h * 1.3 || Math.abs(ratioNew - ratioOld) > 0.35) {
        reqSize = next;
        preloaded.clear();
        if (pos >= 0) showBg(history[pos]);
      }
    }, 400);
  });

  // ---------- History & rendering ----------
  const history = [];
  let pos = -1;

  function newEntry() {
    const q = pickQuote();
    if (!state.seen.includes(q.id)) {
      state.seen.push(q.id);
      if (state.seen.length > QUOTES.length * 0.8) state.seen = state.seen.slice(-Math.floor(QUOTES.length * 0.5));
    }
    return { id: q.id, bg: pickBg() };
  }

  function current() { return BY_ID.get(history[pos].id); }

  function lengthClass(t) {
    const n = t.length;
    if (n <= 55) return "len-s";
    if (n <= 110) return "len-m";
    if (n <= 170) return "len-l";
    return "len-xl";
  }

  function paintQuote() {
    const q = current();
    el.text.textContent = q.t;
    el.author.textContent = q.a;
    el.quote.classList.remove("len-s", "len-m", "len-l", "len-xl");
    el.quote.classList.add(lengthClass(q.t));
    syncButtons();
  }

  function syncButtons() {
    const id = history[pos].id;
    el.like.setAttribute("aria-pressed", state.liked.includes(id));
    el.dislike.setAttribute("aria-pressed", state.disliked.includes(id));
    const isFav = state.favorites.some((f) => f.id === id);
    el.fav.setAttribute("aria-pressed", isFav);
    el.fav.setAttribute("aria-label", isFav ? "Remove from favorites" : "Add to favorites");
    el.prev.disabled = pos <= 0;
    el.favCount.textContent = state.favorites.length;
  }

  let animating = false;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function go(dir) {
    if (animating) return;
    if (dir < 0 && pos <= 0) return;
    animating = true;
    if (dir > 0) {
      if (pos === history.length - 1) history.push(newEntry());
      pos++;
    } else {
      pos--;
    }
    save();
    const entry = history[pos];
    showBg(entry);
    // warm the next background
    if (pos === history.length - 1) prefetchNext();

    if (reduceMotion) { paintQuote(); animating = false; return; }
    el.quote.classList.add(dir > 0 ? "out-up" : "out-down");
    setTimeout(() => {
      paintQuote();
      el.quote.classList.remove("out-up", "out-down");
      el.quote.classList.add(dir > 0 ? "in-up" : "in-down");
      void el.quote.offsetWidth;
      el.quote.classList.remove("in-up", "in-down");
      setTimeout(() => { animating = false; }, 420);
    }, 380);
  }

  let pending = null;
  function prefetchNext() {
    // Pre-pick the next entry so its photo is cached before the user moves on.
    pending = newEntry();
    history.push(pending);
    loadImage(pending.bg).catch(() => {});
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 1800);
  }
  function pop(btn) { btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); }

  // ---------- Like / dislike / favorite ----------
  function toggleLike() {
    const q = current();
    pop(el.like);
    if (state.liked.includes(q.id)) {
      state.liked = state.liked.filter((x) => x !== q.id);
      adjust(q, -1);
    } else {
      if (state.disliked.includes(q.id)) { state.disliked = state.disliked.filter((x) => x !== q.id); adjust(q, +1); }
      state.liked.push(q.id);
      adjust(q, +1);
      toast("You'll see more quotes like this");
    }
    resetUpcoming();
    save(); syncButtons();
  }

  function toggleDislike() {
    const q = current();
    pop(el.dislike);
    if (state.disliked.includes(q.id)) {
      state.disliked = state.disliked.filter((x) => x !== q.id);
      adjust(q, +1);
      save(); syncButtons();
      return;
    }
    if (state.liked.includes(q.id)) { state.liked = state.liked.filter((x) => x !== q.id); adjust(q, -1); }
    state.disliked.push(q.id);
    adjust(q, -1);
    resetUpcoming();
    save(); syncButtons();
    toast("Got it, fewer like this");
    setTimeout(() => go(1), 650);
  }

  // After a rating changes, re-pick the pre-fetched upcoming quote so the change applies right away.
  function resetUpcoming() {
    if (pending && history[history.length - 1] === pending && pos < history.length - 1) {
      history.pop();
      prefetchNext();
    }
  }

  function toggleFav() {
    const q = current();
    pop(el.fav);
    const i = state.favorites.findIndex((f) => f.id === q.id);
    if (i >= 0) {
      state.favorites.splice(i, 1);
      toast("Removed from your wall");
    } else {
      state.favorites.push({ id: q.id, at: Date.now() });
      el.favCount.classList.remove("bump"); void el.favCount.offsetWidth; el.favCount.classList.add("bump");
      toast("Pinned to your wall");
    }
    save(); syncButtons();
  }

  // ---------- Favorites wall ----------
  function renderWall() {
    el.board.innerHTML = "";
    const favs = state.favorites.slice().reverse();
    el.wall.classList.toggle("is-empty", favs.length === 0);
    el.wallSub.textContent = favs.length
      ? `${favs.length} ${favs.length === 1 ? "quote" : "quotes"} pinned. Tap one to open it.`
      : "Quotes you star are pinned here.";
    favs.forEach((f) => {
      const q = BY_ID.get(f.id);
      if (!q) return;
      const seed = parseInt(f.id, 36);
      const note = document.createElement("div");
      note.className = `note c${seed % 5}`;
      note.style.setProperty("--tilt", `${((seed % 7) - 3) * 0.7}deg`);
      note.tabIndex = 0;
      note.setAttribute("role", "button");
      note.setAttribute("aria-label", `Open quote: ${q.t}`);
      note.innerHTML = `<p></p><span class="by"></span>
        <button class="unpin" aria-label="Remove from favorites"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
      note.querySelector("p").textContent = q.t;
      note.querySelector(".by").textContent = q.a;
      note.addEventListener("click", (e) => {
        if (e.target.closest(".unpin")) return;
        openFromWall(q.id);
      });
      note.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFromWall(q.id); } });
      note.querySelector(".unpin").addEventListener("click", (e) => {
        e.stopPropagation();
        note.classList.add("leaving");
        state.favorites = state.favorites.filter((x) => x.id !== q.id);
        save(); syncButtons();
        setTimeout(renderWall, 340);
      });
      el.board.appendChild(note);
    });
  }

  function openWall() {
    renderWall();
    el.wall.classList.add("open");
    el.wall.setAttribute("aria-hidden", "false");
    el.wall.scrollTop = 0;
    setTimeout(() => el.closeWall.focus(), 300);
  }
  function closeWall() {
    el.wall.classList.remove("open");
    el.wall.setAttribute("aria-hidden", "true");
    el.openWall.focus();
  }
  function openFromWall(id) {
    // insert the chosen quote right after the current one and move to it
    if (pending && history[history.length - 1] === pending) history.pop();
    history.splice(pos + 1, 0, { id, bg: pickBg() });
    closeWall();
    animating = false;
    go(1);
  }

  // ---------- Music ----------
  const ambient = new window.Ambient();
  const MODES = window.Ambient.MODES;
  const modeBtn = $("modeBtn"), modeName = $("modeName"), modeHz = $("modeHz");
  let mode = "gamma";
  try { const m = localStorage.getItem(KEY + ".mode"); if (MODES[m]) mode = m; } catch (e) {}
  let headphoneTipShown = false;
  try { headphoneTipShown = !!localStorage.getItem(KEY + ".hp"); } catch (e) {}

  function paintMode() {
    const m = MODES[mode];
    modeName.textContent = m.label;
    modeHz.textContent = m.hz;
    const other = MODES[mode === "gamma" ? "alpha" : "gamma"];
    modeBtn.setAttribute("aria-label", `${m.label} ${m.hz} (${m.note}). Switch to ${other.label} ${other.hz}`);
  }
  paintMode();
  ambient.setMode(mode);

  modeBtn.addEventListener("click", () => {
    mode = mode === "gamma" ? "alpha" : "gamma";
    try { localStorage.setItem(KEY + ".mode", mode); } catch (e) {}
    ambient.setMode(mode);
    paintMode();
    const m = MODES[mode];
    toast(`${m.label} ${m.hz} for ${m.note}`);
  });

  el.music.addEventListener("click", () => {
    const on = el.music.getAttribute("aria-pressed") !== "true";
    el.music.setAttribute("aria-pressed", on);
    el.music.setAttribute("aria-label", on ? "Pause binaural music" : "Play binaural music");
    if (on) {
      ambient.play();
      if (!headphoneTipShown) {
        toast("Use headphones to hear the binaural beat");
        headphoneTipShown = true;
        try { localStorage.setItem(KEY + ".hp", "1"); } catch (e) {}
      }
    } else ambient.pause();
  });

  // ---------- Input ----------
  el.next.addEventListener("click", () => go(1));
  el.prev.addEventListener("click", () => go(-1));
  el.like.addEventListener("click", toggleLike);
  el.dislike.addEventListener("click", toggleDislike);
  el.fav.addEventListener("click", toggleFav);
  el.openWall.addEventListener("click", openWall);
  el.closeWall.addEventListener("click", closeWall);

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (el.wall.classList.contains("open")) { if (e.key === "Escape") closeWall(); return; }
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown") { e.preventDefault(); go(1); }
    else if (k === " " && e.target === document.body) { e.preventDefault(); go(1); }
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") { e.preventDefault(); go(-1); }
    else if (k === "l" || k === "L") toggleLike();
    else if (k === "d" || k === "D") toggleDislike();
    else if (k === "f" || k === "F") toggleFav();
    else if (k === "m" || k === "M") el.music.click();
  });

  // Vertical swipe on touch: up = next, down = previous
  let touchStart = null;
  el.stage.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  el.stage.addEventListener("touchmove", (e) => {
    if (!touchStart || animating) return;
    const dy = e.touches[0].clientY - touchStart.y;
    const dx = e.touches[0].clientX - touchStart.x;
    if (Math.abs(dy) > Math.abs(dx)) {
      const damp = Math.max(-60, Math.min(60, dy * 0.35));
      el.quote.style.transition = "none";
      el.quote.style.transform = `translateY(${damp}px)`;
      el.quote.style.opacity = String(1 - Math.min(Math.abs(dy) / 400, 0.4));
    }
  }, { passive: true });
  el.stage.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const fast = Date.now() - touchStart.t < 300;
    touchStart = null;
    el.quote.style.transition = "";
    el.quote.style.transform = "";
    el.quote.style.opacity = "";
    if (Math.abs(dy) > Math.abs(dx) && (Math.abs(dy) > 60 || (fast && Math.abs(dy) > 30))) {
      if (dy < 0) { go(1); hideHint(); } else go(-1);
    }
  });

  // Mouse wheel / trackpad on desktop (throttled)
  let wheelLock = 0;
  el.stage.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) < 25) return;
    const now = Date.now();
    if (now < wheelLock) return;
    wheelLock = now + 900;
    go(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  function hideHint() {
    el.hint.classList.add("gone");
    try { localStorage.setItem(KEY + ".hint", "1"); } catch (e) {}
  }
  try { if (localStorage.getItem(KEY + ".hint")) el.hint.classList.add("gone"); } catch (e) {}

  // ---------- Start ----------
  history.push(newEntry());
  pos = 0;
  paintQuote();
  showBg(history[0]);
  prefetchNext();
  save();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
