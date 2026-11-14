// ==UserScript==
// @name         Running Timer Watcher
// @namespace    local.running-timer-watcher
// @version      1.4
// @author       Mohsen Hajihosseinnejad • alias: MOHAJIHO • email: mohajiho@gmail.com
// @description  Finds every running stopwatch on the page by itself (any time in the 00:00 format that counts up once a second, whatever its class name; clocks are ignored). When one reaches its own target time shown next to it as "/ 00:00" (or 05:00 if it has none), it plays a short two-note chime (G5 → C5) and puts a red border around it for a few seconds.
// @match        *://*.mohsenusa.github.io/*
// @match        *://a.man-dash.b.test.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  // Sites: add one "// @match" line per site in the header above.

  // ---------- Settings: true = ON, false = OFF ----------
  const SETTINGS = {
    // Each stopwatch alerts when it reaches its own target, the "/ 00:00" time shown next to it (e.g. "03:12 / 08:00" → alert at 08:00)
    ALERT_AT: '05:00', // only for stopwatches with no "/ 00:00" target next to them (00:00 format: minutes:seconds)
    ALERT_WITHOUT_TARGET: true, // false = stopwatches with no "/ 00:00" target never alert
    ALERT_IF_ALREADY_OVER: true, // stopwatches already past their target when the page opens alert too
    SKIP: '', // parts of the page to never watch, as a CSS selector, e.g. '.sidebar' for an area that should be ignored

    SOUND: true, // built-in alarm: the "Reversed Lush Chime" (G5 → C5, about 1.3 s), made in the browser (no sound file)
    SOUND_VOLUME: 1, // 0.05 (quiet) to 1 (as loud as the original chime tester page)
    BORDER_SECONDS: 8, // how long the red border stays around a stopwatch that just reached its target (5 to 10 works well)
    BORDER_COLOR: '#d92d20'
  };

  const log = (...a) => console.info('[TimerWatcher]', ...a);
  const BORDER_ATTR = 'data-timerwatcher-alert';
  const ROW = 'tr, li, [role="row"]';
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'TITLE']);

  if (SETTINGS.SKIP) {
    try { document.querySelector(SETTINGS.SKIP); } catch {
      console.error('[TimerWatcher] SKIP setting is not a valid selector:', SETTINGS.SKIP);
      return;
    }
  }

  // GM_addStyle works even on sites whose security settings block added <style> tags
  GM_addStyle(`
    [${BORDER_ATTR}] {
      outline: 3px solid ${SETTINGS.BORDER_COLOR} !important; outline-offset: 2px !important;
      border-radius: 4px !important;
    }`);

  // Only the 00:00 format counts (two digits, colon, two digits): "04:59" → 299.
  // A clock with seconds like "10:32:15" or "1:05:00" is not 00:00, so it is never counted.
  // A time right after a "/" is a target ("03:12 / 08:00" → running 192, target 480), not a running time.
  // null when not found (the last one in the text is used)
  const MMSS = /(?<![\d:])(\d{2}):([0-5]\d)(?![\d:])/g;
  const SLASH_TIME = /\/\s*(\d{2}):([0-5]\d)(?![\d:])/;
  const readTimes = (text) => {
    const s = String(text);
    let running = null;
    let target = null;
    for (const m of s.matchAll(MMSS)) {
      const secs = +m[1] * 60 + +m[2];
      if (/\/\s*$/.test(s.slice(0, m.index))) target = secs;
      else running = secs;
    }
    return { running, target };
  };
  const toSeconds = (text) => readTimes(text).running;
  const LIMIT = toSeconds(SETTINGS.ALERT_AT);
  if (LIMIT === null) {
    console.error('[TimerWatcher] ALERT_AT must look like 05:00 (two digits, colon, two digits), got:', SETTINGS.ALERT_AT);
    return;
  }

  // ---------- Finding times on the page, whatever their class names ----------
  // Every piece of text that looks like a time; the element right around it is the candidate.
  const ownText = (el) => {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.data;
    return s;
  };
  const findCandidates = () => {
    const els = new Set();
    if (!document.body) return [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/\d\d:\d\d/.test(n.data)) continue;
      const el = n.parentElement;
      if (!el || SKIP_TAGS.has(el.tagName) || (SETTINGS.SKIP && el.closest(SETTINGS.SKIP))) continue;
      els.add(el);
    }
    const out = [];
    for (const el of els) {
      const { running, target } = readTimes(ownText(el));
      if (running !== null) out.push({ el, secs: running, ownTarget: target });
    }
    return out;
  };

  // ---------- Telling stopwatches apart from clocks and dates ----------
  // A time counts as a stopwatch once it has gone up at about one second per second.
  // A clock like "10:32" also looks like a time, but it goes up one minute per minute, so it never qualifies.
  // Once one stopwatch proves itself, every time in the same spot of other rows (same column, same
  // kind of element) counts right away, so rows the dashboard redraws or adds are recognised at once.
  const firstSeen = new WeakMap(); // element -> { secs, at }
  const provenSpots = new Set();

  const indexOf = (el) => {
    let i = 0;
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) i++;
    return i;
  };
  const part = (el) => `${el.tagName}${[...el.classList].sort().map((c) => `.${c}`).join('')}:${indexOf(el)}`;
  // Where the time sits inside its row, e.g. "TR > TD:4 > SPAN.elapsedTime:0"
  const spotOf = (el) => {
    const row = el.closest(ROW);
    const parts = [];
    let n = el;
    for (let i = 0; i < 4 && n && n !== row && n !== document.body; i++, n = n.parentElement) parts.unshift(part(n));
    return (row ? `${row.tagName} > ` : '') + parts.join(' > ');
  };

  const checkTicking = (el, secs, spot, now) => {
    if (provenSpots.has(spot)) return;
    const s = firstSeen.get(el);
    if (!s || secs < s.secs) { firstSeen.set(el, { secs, at: now }); return; } // new, or went down (reset or countdown)
    const counted = secs - s.secs;
    const waited = (now - s.at) / 1000;
    if (counted >= 3 && Math.abs(counted - waited) <= Math.max(3, waited * 0.2)) {
      provenSpots.add(spot);
      log(`Found a running stopwatch at ${spot} (showing ${ownText(el).trim()}); watching it on every row.`);
    }
  };

  // ---------- Which row a stopwatch belongs to ----------
  // Used to remember what already alerted, even if the dashboard redraws the row: the row's text
  // without any times in it (e.g. order number + name). Falls back to the element itself.
  const rowOf = (el, others) => {
    const row = el.closest(ROW);
    if (row) return row;
    let node = el;
    for (let i = 0; i < 8; i++) {
      const p = node.parentElement;
      if (!p || p === document.body || others.some((o) => o !== el && p.contains(o))) break;
      node = p;
    }
    return node;
  };
  const ids = new WeakMap();
  let nextId = 0;
  const keyOf = (el, others) => {
    const text = (rowOf(el, others).textContent || '')
      .replace(/\d+:\d{2}(?::\d{2})?/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (text) return text;
    if (!ids.has(el)) ids.set(el, `#${++nextId}`);
    return ids.get(el);
  };

  // ---------- Each stopwatch's own target ("/ 00:00") ----------
  // Looked for in the stopwatch's own text first, then in the elements around it, nearest first,
  // but never in an area that holds another stopwatch (that would be another row's target).
  const targetOf = (t, watchedEls) => {
    if (t.ownTarget) return t.ownTarget;
    let node = t.el;
    for (let i = 0; i < 4; i++) {
      const p = node.parentElement;
      if (!p || p === document.body || watchedEls.some((o) => o !== t.el && p.contains(o))) break;
      const texts = [];
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement !== t.el) texts.push(n.data); // the running time itself is left out
      }
      const m = texts.join(' ').match(SLASH_TIME);
      if (m && (+m[1] * 60 + +m[2]) > 0) return +m[1] * 60 + +m[2];
      node = p;
    }
    return null;
  };
  const limitOf = (t, watchedEls) => {
    const target = targetOf(t, watchedEls);
    if (target) return target;
    return SETTINGS.ALERT_WITHOUT_TARGET ? LIMIT : null;
  };
  const fmt = (secs) => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  // ---------- Every second ----------
  const alertedEls = new WeakSet();
  const alertedKeys = new Map(); // row key -> last time seen late (forgotten after 10 minutes away)
  const borderUntil = new Map(); // row key -> time the border comes off
  let primed = false;
  let testUntil = 0;
  let watchedNow = [];

  const scan = () => {
    const now = Date.now();
    const found = findCandidates();
    found.forEach((t) => { t.spot = spotOf(t.el); });
    found.forEach((t) => checkTicking(t.el, t.secs, t.spot, now));

    const watched = found.filter((t) => provenSpots.has(t.spot));
    const watchedEls = watched.map((t) => t.el);
    watched.forEach((t) => { t.limit = limitOf(t, watchedEls); });
    watchedNow = watched;

    const late = watched.filter((t) => t.limit !== null && t.secs >= t.limit);
    late.forEach((t) => { t.key = keyOf(t.el, watchedEls); });

    if (provenSpots.size) {
      const fresh = late.filter((t) => !alertedEls.has(t.el) && !alertedKeys.has(t.key));
      const alertNow = primed || SETTINGS.ALERT_IF_ALREADY_OVER ? fresh : [];
      primed = true;
      late.forEach((t) => { alertedEls.add(t.el); alertedKeys.set(t.key, now); });
      if (alertNow.length) alertUser(alertNow, now);
    }
    for (const [k, seen] of alertedKeys) if (now - seen > 10 * 60_000) alertedKeys.delete(k);

    // Borders: put back on redrawn rows while their time is up, take off when it runs out
    for (const [k, until] of borderUntil) if (now >= until) borderUntil.delete(k);
    const want = new Set(late.filter((t) => borderUntil.has(t.key)).map((t) => t.el));
    if (now < testUntil) watchedEls.forEach((el) => want.add(el));
    for (const el of document.querySelectorAll(`[${BORDER_ATTR}]`)) if (!want.has(el)) el.removeAttribute(BORDER_ATTR);
    for (const el of want) if (!el.hasAttribute(BORDER_ATTR)) el.setAttribute(BORDER_ATTR, '');

    updatePill();
  };

  function alertUser(items, now) {
    log(`⏰ ${items.length} stopwatch${items.length === 1 ? '' : 'es'} reached ${items.length === 1 ? 'its' : 'their'} target:`,
      items.map((t) => `${ownText(t.el).trim()} (target ${fmt(t.limit)}) | ${t.key}`));
    items.forEach((t) => borderUntil.set(t.key, now + SETTINGS.BORDER_SECONDS * 1000));
    if (SETTINGS.SOUND) alarm();
  }

  // ---------- Built-in alarm: Reversed Lush Chime ----------
  // One sound player for the whole page. Browsers only let a page make sound after a click or key
  // press on that page, so the player is switched on during your first click and then reused for
  // every alarm (a new player made later by a timer would be blocked again in some browsers).
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let alarmUntil = 0;

  const getCtx = () => {
    if (!AC) return null;
    if (ctx && ctx.state !== 'closed') return ctx;
    try { ctx = new AC(); } catch (e) { log('Could not start sound:', e); ctx = null; return null; }
    ctx.onstatechange = () => updatePill();
    return ctx;
  };

  // Runs inside your click / key press: the only moment browsers allow sound to be switched on
  const unlock = () => {
    const c = getCtx();
    if (!c || c.state === 'running') return;
    c.resume().catch(() => {});
    // Safari also wants something played during the click: one silent sample
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
    } catch { /* not needed in other browsers */ }
  };
  ['pointerdown', 'keydown', 'touchend'].forEach((type) => window.addEventListener(type, unlock, true));

  const soundAllowed = () => {
    if (ctx && ctx.state === 'running') return true;
    if (typeof navigator.getAutoplayPolicy === 'function') {
      try { return navigator.getAutoplayPolicy('audiocontext') === 'allowed'; } catch { /* older Firefox */ }
    }
    return false;
  };

  // One chime bar: each partial (overtone) strikes fast and fades on its own
  const strikeBar = (c, freq, start, duration, volume, partials, dest) => {
    partials.forEach((p) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      const end = start + duration * p.decayFactor;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * p.ratio, start);
      if (p.detune) osc.detune.setValueAtTime(p.detune, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(volume * p.gain, start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(dest);
      osc.start(start);
      osc.stop(end + 0.03);
    });
  };

  // "Reversed Lush Chime": G5 then C5 240 ms later, slightly left then slightly right
  const LUSH = [
    { ratio: 1, gain: 0.85, decayFactor: 1, detune: -3 }, // two slightly detuned copies give the warm shimmer
    { ratio: 1, gain: 0.85, decayFactor: 1, detune: 3 },
    { ratio: 2, gain: 0.3, decayFactor: 0.75 },
    { ratio: 3, gain: 0.1, decayFactor: 0.35 },
    { ratio: 4, gain: 0.05, decayFactor: 0.15 }
  ];
  const play = (c) => {
    const vol = Math.min(1, Math.max(0.05, SETTINGS.SOUND_VOLUME)); // 1 = as loud as the original tester page
    const now = c.currentTime + 0.02;
    const pan = (value) => {
      if (!c.createStereoPanner) return c.destination; // older Safari: no left/right spread
      const p = c.createStereoPanner();
      p.pan.value = value;
      p.connect(c.destination);
      return p;
    };
    const left = pan(-0.2);
    const right = pan(0.2);
    strikeBar(c, 783.99, now, 0.85, 0.26 * vol, LUSH, left); // G5
    strikeBar(c, 1567.98, now, 0.55, 0.05 * vol, [{ ratio: 1, gain: 1, decayFactor: 1 }], left); // G6 sparkle
    strikeBar(c, 523.25, now + 0.24, 1.05, 0.28 * vol, LUSH, right); // C5
    alarmUntil = Date.now() + 1400;
  };

  const alarm = () => {
    if (Date.now() < alarmUntil) return;
    const c = getCtx();
    if (!c) return;
    if (c.state === 'running') { play(c); return; }
    // Already allowed once but paused (e.g. the computer slept): waking it up works without a click
    c.resume().catch(() => {});
    setTimeout(() => {
      if (c.state === 'running') { play(c); return; }
      log('Alarm skipped: sound is not enabled yet (click the page once; the Tampermonkey menu does not count).');
      updatePill();
    }, 300);
  };

  // ---------- Red pill (bottom-left), only while sound is off ----------
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .pill { position: fixed; left: 16px; bottom: 16px; z-index: 2147483646; cursor: pointer;
              font: 600 14px/1.3 system-ui, sans-serif; color: #fff; background: #d92d20;
              padding: 10px 14px; border-radius: 999px; border: 2px solid #fff;
              box-shadow: 0 4px 16px rgba(0,0,0,.35); }
      .pill[hidden] { display: none; }
    </style>
    <div class="pill" hidden>🔇 Click anywhere to turn on the alarm</div>`;
  const pill = shadow.querySelector('.pill');
  document.documentElement.appendChild(host);

  function updatePill() {
    pill.hidden = !SETTINGS.SOUND || soundAllowed();
  }
  window.addEventListener('pointerdown', () => setTimeout(updatePill, 300), true);
  window.addEventListener('keydown', () => setTimeout(updatePill, 300), true);

  // ---------- Menu (Tampermonkey icon) ----------
  const testAlert = () => {
    testUntil = Date.now() + SETTINGS.BORDER_SECONDS * 1000;
    if (SETTINGS.SOUND) alarm();
    scan();
  };
  GM_registerMenuCommand('🔔 Test alert (alarm + border on every watched stopwatch)', testAlert);
  GM_registerMenuCommand('🔍 Show what is watched (3s)', () => {
    log(`Stopwatch spots: ${[...provenSpots].join(' | ') || 'none yet (they need a few seconds of ticking)'}; ` +
      `${watchedNow.length} stopwatch(es):`,
    watchedNow.map((t) => `${ownText(t.el).trim()} → alerts at ${t.limit === null ? 'never (no target)' : fmt(t.limit)}`));
    const els = watchedNow.map((t) => t.el);
    els.forEach((el) => el.style.setProperty('outline', '3px dashed #1971c2', 'important'));
    setTimeout(() => els.forEach((el) => el.style.removeProperty('outline')), 3000);
  });

  if (SETTINGS.SOUND) getCtx(); // where sound is already allowed it starts on now; otherwise the first click does it
  scan();
  setInterval(scan, 1000);
  log(`Looking for running stopwatches anywhere on the page; each alerts at its "/ 00:00" target` +
    (SETTINGS.ALERT_WITHOUT_TARGET ? ` (or ${SETTINGS.ALERT_AT} if it has none).` : ' (never if it has none).'));
})();
