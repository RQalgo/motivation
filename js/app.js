(function () {
  "use strict";

  // ---------- Data ----------
  const P = window.StillpointPicker;
  const QUOTES = window.QUOTES.map((q) => ({ ...q, id: P.hash(q.t) }));
  const BY_ID = new Map(QUOTES.map((q) => [q.id, q]));
  const BG = window.BACKGROUNDS.slice();
  const badBg = new Set();

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
    mirrorPrefs();
  }

  // Mirror preferences to IndexedDB so the service worker can pick the daily quote.
  let mirrorTimer = 0;
  function mirrorPrefs(now) {
    clearTimeout(mirrorTimer);
    const write = () => P.kvSet("prefs", {
      tags: state.tags, authors: state.authors, disliked: state.disliked,
      seen: state.seen.slice(-300), favorites: state.favorites.map((f) => f.id),
    }).catch(() => {});
    if (now) return write();
    mirrorTimer = setTimeout(write, 600);
  }

  // ---------- Preference model ----------
  // Each like nudges the quote's themes and author up; each dislike nudges them down.
  // Selection is weighted-random so new themes still appear (exploration).
  const clamp = P.clamp;
  const authorKey = P.authorKey;

  function adjust(q, delta) {
    q.g.forEach((tag) => { state.tags[tag] = clamp((state.tags[tag] || 0) + delta, -5, 5); });
    const ak = authorKey(q.a);
    state.authors[ak] = clamp((state.authors[ak] || 0) + delta * 0.6, -3, 3);
  }

  function pickQuote() {
    const recentWindow = Math.min(40, Math.floor(QUOTES.length / 3));
    const recent = new Set(history.slice(-recentWindow).map((h) => h.id));
    return P.pick(QUOTES, state, recent);
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
    music: $("musicBtn"), openWall: $("openWall"), daily: $("dailyBtn"),
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
    el.fav.setAttribute("aria-label", isFav ? "Remove from favourites" : "Add to favourites");
    el.prev.disabled = pos <= 0;
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

  // Returns true if the quote is now a favourite. Favouriting also nudges its themes up a little.
  function toggleFav(opts) {
    const q = current();
    pop(el.fav);
    const i = state.favorites.findIndex((f) => f.id === q.id);
    const added = i < 0;
    if (added) {
      state.favorites.push({ id: q.id, at: Date.now() });
      adjust(q, +0.5);
    } else {
      state.favorites.splice(i, 1);
      adjust(q, -0.5);
    }
    if (!(opts && opts.silent)) toast(added ? "Pinned to your wall" : "Removed from your wall");
    save(); syncButtons();
    return added;
  }

  // Star that pops over the quote after a double-tap: filled = saved, outline fading = removed.
  function flashStar(added) {
    const r = el.quote.getBoundingClientRect();
    const f = document.createElement("div");
    f.className = "fav-flash " + (added ? "add" : "remove");
    f.style.left = r.left + r.width / 2 + "px";
    f.style.top = r.top + r.height / 2 + "px";
    f.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.6l6-.9z"/></svg>';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 900);
  }
  function doubleTapFav() {
    if (el.wall.classList.contains("open")) return;
    flashStar(toggleFav({ silent: true }));
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
        <button class="unpin" aria-label="Remove from favourites"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
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
  // insert a chosen quote right after the current one and move to it
  function jumpTo(id) {
    if (!BY_ID.has(id)) return;
    if (pending && history[history.length - 1] === pending) history.pop();
    history.splice(pos + 1, 0, { id, bg: pickBg() });
    animating = false;
    go(1);
  }
  function openFromWall(id) {
    closeWall();
    jumpTo(id);
  }

  // ---------- Music ----------
  // RQ's "40Hz Gamma Binaural Beats" track. The original repeats a ~74 s passage for
  // two hours, so the app ships one cycle (0.9 MB) and loops it gaplessly with Web Audio.
  // The file holds 0.5 s of padding either side of the loop so decoder delay never
  // lands inside the loop window. Never autoplays; fades in and out.
  const MUSIC = { url: "audio/focus-40hz.m4a", loopStart: 0.5, loopLength: 3544611 / 48000 };
  let actx = null, musicGain = null, musicBuffer = null, musicSrc = null, loadPromise = null;
  let startedAt = 0, offset = 0, musicOn = false;
  let headphoneTipShown = false;
  try { headphoneTipShown = !!localStorage.getItem(KEY + ".hp"); } catch (e) {}

  function setMusicUi(on) {
    el.music.setAttribute("aria-pressed", on);
    el.music.setAttribute("aria-label", on ? "Pause focus music" : "Play focus music");
  }

  function loadMusic() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(MUSIC.url)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((ab) => new Promise((res, rej) => actx.decodeAudioData(ab, res, rej)))
      .then((buf) => (musicBuffer = buf))
      .catch((e) => { loadPromise = null; throw e; });
    return loadPromise;
  }

  async function startMusic() {
    musicOn = true;
    setMusicUi(true);
    // the context must be created/resumed inside the tap for iOS
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      musicGain = actx.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(actx.destination);
    }
    actx.resume();
    el.music.classList.add("loading");
    try {
      await loadMusic();
    } catch (e) {
      el.music.classList.remove("loading");
      musicOn = false;
      setMusicUi(false);
      toast("Couldn't load the music. Check your connection and try again.");
      return;
    }
    el.music.classList.remove("loading");
    if (!musicOn) return; // paused while loading
    if (musicSrc) { try { musicSrc.stop(); } catch (e) {} }
    musicSrc = actx.createBufferSource();
    musicSrc.buffer = musicBuffer;
    musicSrc.loop = true;
    musicSrc.loopStart = MUSIC.loopStart;
    musicSrc.loopEnd = MUSIC.loopStart + MUSIC.loopLength;
    musicSrc.connect(musicGain);
    const t = actx.currentTime;
    musicSrc.start(t, MUSIC.loopStart + offset);
    startedAt = t - offset;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(musicGain.gain.value, t);
    musicGain.gain.linearRampToValueAtTime(1, t + 2);
    if (!headphoneTipShown) {
      toast("Use headphones to hear the binaural beat");
      headphoneTipShown = true;
      try { localStorage.setItem(KEY + ".hp", "1"); } catch (e) {}
    }
  }

  function stopMusic() {
    musicOn = false;
    setMusicUi(false);
    el.music.classList.remove("loading");
    if (!actx || !musicSrc) return;
    const t = actx.currentTime;
    offset = (t - startedAt) % MUSIC.loopLength; // resume from the same spot
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(musicGain.gain.value, t);
    musicGain.gain.linearRampToValueAtTime(0, t + 1);
    const src = musicSrc;
    musicSrc = null;
    src.stop(t + 1.05);
    setTimeout(() => { if (!musicOn) actx.suspend(); }, 1200);
  }

  el.music.addEventListener("click", () => { if (musicOn) stopMusic(); else startMusic(); });

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
  let lastTap = null, lastTouchAt = 0;
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
    const now = Date.now();
    lastTouchAt = now;
    // double-tap (two quick taps in the same spot, not on a button) toggles favourite
    const onControl = e.target.closest && e.target.closest("button, a");
    if (!onControl && Math.hypot(dx, dy) < 12 && now - touchStart.t < 300) {
      const x = e.changedTouches[0].clientX, y = e.changedTouches[0].clientY;
      if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
        lastTap = null;
        if (e.cancelable) e.preventDefault();
        doubleTapFav();
      } else {
        lastTap = { t: now, x, y };
      }
    } else {
      lastTap = null;
    }
    touchStart = null;
    el.quote.style.transition = "";
    el.quote.style.transform = "";
    el.quote.style.opacity = "";
    if (Math.abs(dy) > Math.abs(dx) && (Math.abs(dy) > 60 || (fast && Math.abs(dy) > 30))) {
      if (dy < 0) { go(1); hideHint(); } else go(-1);
    }
  });

  // Double-click on desktop (ignored right after touches, which some browsers also report as dblclick)
  el.stage.addEventListener("dblclick", (e) => {
    if (Date.now() - lastTouchAt < 800) return;
    if (e.target.closest("button, a")) return;
    const sel = window.getSelection && window.getSelection();
    if (sel) sel.removeAllRanges();
    doubleTapFav();
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

  // ---------- Quote of the day notification ----------
  // Uses Periodic Background Sync: available to installed apps in Chrome and Edge
  // (Android, Windows, macOS, ChromeOS). The service worker wakes about twice a day,
  // and once per day after 7am picks a quote with the same preference model and shows it.
  // The bell only appears where this works.
  async function setupDaily(reg) {
    if (!el.daily || !("Notification" in window) || !reg || !("periodicSync" in reg)) return;
    let perm;
    try { perm = await navigator.permissions.query({ name: "periodic-background-sync" }); } catch (e) { return; }
    if (perm.state !== "granted") return; // not installed as an app
    let tags = [];
    try { tags = await reg.periodicSync.getTags(); } catch (e) {}
    const paint = (on) => {
      el.daily.setAttribute("aria-pressed", on);
      el.daily.setAttribute("aria-label", on ? "Turn off quote of the day" : "Turn on quote of the day");
    };
    paint(tags.includes("qotd") && Notification.permission === "granted");
    el.daily.hidden = false;
    el.daily.addEventListener("click", async () => {
      if (el.daily.getAttribute("aria-pressed") === "true") {
        try { await reg.periodicSync.unregister("qotd"); } catch (e) {}
        paint(false);
        toast("Quote of the day is off");
        return;
      }
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        toast("Notifications are blocked. Allow them in settings to get a daily quote.");
        return;
      }
      try {
        await reg.periodicSync.register("qotd", { minInterval: 12 * 60 * 60 * 1000 });
      } catch (e) {
        toast("Couldn't schedule the daily quote on this device.");
        return;
      }
      paint(true);
      await mirrorPrefs(true);
      if (reg.active) reg.active.postMessage({ type: "qotd-now" }); // today's quote right away
      toast("Quote of the day is on. Here's today's.");
    });
  }

  // Opening a notification focuses the app and shows that quote
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "show-quote") jumpTo(e.data.id);
    });
  }

  // ---------- Start ----------
  let startId = null;
  try {
    const params = new URLSearchParams(location.search);
    startId = params.get("q");
    if (startId) window.history.replaceState(null, "", location.pathname);
  } catch (e) {}
  if (startId && BY_ID.has(startId)) {
    history.push({ id: startId, bg: pickBg() });
  } else {
    history.push(newEntry());
  }
  pos = 0;
  paintQuote();
  showBg(history[0]);
  prefetchNext();
  save();

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(setupDaily)
      .catch(() => {});
  }
})();
