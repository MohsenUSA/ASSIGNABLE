// ==UserScript==
// @name         Running Timer Watcher
// @namespace    local.running-timer-watcher
// @version      1.2
// @author       Mohsen Hajihosseinnejad • alias: MOHAJIHO • email: mohajiho@gmail.com
// @description  Finds every running stopwatch on the page by itself (any time in the 00:00 format that counts up once a second, whatever its class name; clocks are ignored). When one passes 05:00 it plays a two-note alarm and puts a red border around it for a few seconds.
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
    ALERT_AT: '05:00', // alert when a stopwatch reaches this (00:00 format: minutes:seconds)
    ALERT_IF_ALREADY_OVER: true, // stopwatches already past ALERT_AT when the page opens alert too
    SKIP: '', // parts of the page to never watch, as a CSS selector, e.g. '.sidebar' for an area that should be ignored

    SOUND: true, // built-in two-note alarm, made in the browser (no sound file)
    SOUND_SECONDS: 3, // how long the alarm repeats each time
    SOUND_VOLUME: 0.75, // 0.05 (quiet) to 1 (maximum)
    BORDER_SECONDS: 8, // how long the red border stays around a stopwatch that just passed ALERT_AT (5 to 10 works well)
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
  // null if no 00:00 time found (uses the last one in the text)
  const MMSS = /(?<![\d:])(\d{2}):([0-5]\d)(?![\d:])/g;
  const toSeconds = (text) => {
    const all = [...String(text).matchAll(MMSS)];
    if (!all.length) return null;
    const m = all[all.length - 1];
    return +m[1] * 60 + +m[2];
  };
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
      const secs = toSeconds(ownText(el));
      if (secs !== null) out.push({ el, secs });
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
    watchedNow = watchedEls;

    const late = watched.filter((t) => t.secs >= LIMIT);
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
    log(`⏰ ${items.length} stopwatch${items.length === 1 ? '' : 'es'} reached ${SETTINGS.ALERT_AT}:`,
      items.map((t) => `${ownText(t.el).trim()} | ${t.key}`));
    items.forEach((t) => borderUntil.set(t.key, now + SETTINGS.BORDER_SECONDS * 1000));
    if (SETTINGS.SOUND) alarm();
  }

  // ---------- Built-in alarm: two notes, high-low, repeated ----------
  // A fresh sound player each time, so it can't go quiet on a tab left open for hours
  const AC = window.AudioContext || window.webkitAudioContext;
  let alarmUntil = 0;

  const soundAllowed = () => {
    if (typeof navigator.getAutoplayPolicy === 'function') {
      try { return navigator.getAutoplayPolicy('audiocontext') === 'allowed'; } catch { /* older Firefox */ }
    }
    return !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
  };

  const alarm = () => {
    if (!AC || Date.now() < alarmUntil) return;
    let c;
    try { c = new AC(); } catch (e) { log('Could not start sound:', e); return; }
    const play = () => {
      const HIGH = 988; // B5
      const LOW = 740; // F#5
      const NOTE = 0.65; // seconds each note sounds
      const STEP = 0.73; // note + short gap
      const pairs = Math.max(1, Math.round(SETTINGS.SOUND_SECONDS / (2 * STEP)));
      const vol = Math.min(1, Math.max(0.05, SETTINGS.SOUND_VOLUME));
      const t0 = c.currentTime + 0.02;
      for (let i = 0; i < pairs * 2; i++) {
        const s = t0 + i * STEP;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'triangle';
        osc.frequency.value = i % 2 ? LOW : HIGH;
        gain.gain.setValueAtTime(0.0001, s);
        gain.gain.exponentialRampToValueAtTime(vol, s + 0.015);
        gain.gain.setValueAtTime(vol, s + NOTE - 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, s + NOTE);
        osc.connect(gain).connect(c.destination);
        osc.start(s);
        osc.stop(s + NOTE + 0.02);
      }
      const totalMs = pairs * 2 * STEP * 1000;
      alarmUntil = Date.now() + totalMs;
      setTimeout(() => c.close().catch(() => {}), totalMs + 300);
    };
    if (c.state === 'running') { play(); return; }
    c.resume().catch(() => {});
    setTimeout(() => {
      if (c.state === 'running') { play(); return; }
      log('Alarm skipped: sound is not enabled yet (click the page once).');
      c.close().catch(() => {});
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
    <div class="pill" hidden>🔇 Click anywhere to turn on the 05:00 alarm</div>`;
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
      `${watchedNow.length} stopwatch(es):`, watchedNow.map((el) => ownText(el).trim()));
    watchedNow.forEach((el) => el.style.setProperty('outline', '3px dashed #1971c2', 'important'));
    setTimeout(() => watchedNow.forEach((el) => el.style.removeProperty('outline')), 3000);
  });

  scan();
  setInterval(scan, 1000);
  log(`Looking for running stopwatches anywhere on the page; alert at ${SETTINGS.ALERT_AT}.`);
})();
