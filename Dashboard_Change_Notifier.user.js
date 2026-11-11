// ==UserScript==
// @name         Dashboard Change Notifier
// @namespace    local.dashboard-change-notifier
// @version      2.3
// @author       Mohsen Hajihosseinnejad • alias: MOHAJIHO • email: mohajiho@gmail.com
// @description  Watches the elapsed-time stopwatches on the dashboard and alerts when any row reaches 05:00. Uses its own built-in alarm (no sound files), a desktop notification, a flashing banner and a flashing tab title.
// @match        *://*.mohsenusa.github.io/*
// @match        *://a.man-dash.b.test.com/*
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  // Sites: add one "// @match" line per site in the header above.

  // ---------- Settings: true = ON, false = OFF ----------
  const SETTINGS = {
    TIMER: '.procurementListCreatedTime .elapsedTime', // the stopwatch: class elapsedTime inside class procurementListCreatedTime
    ALERT_AT: '05:00', // alert when a stopwatch reaches this (mm:ss or h:mm:ss)
    ALERT_IF_ALREADY_OVER: true, // rows already past ALERT_AT when the page opens alert too

    SOUND: true, // built-in two-note alarm, made in the browser (no sound file)
    SOUND_SECONDS: 4, // how long the alarm repeats each time
    SOUND_VOLUME: 0.35, // 0.05 (quiet) to 1 (maximum)
    REPEAT_EVERY_SECONDS: 0, // 0 = play once when a row reaches ALERT_AT; e.g. 30 = repeat every 30s until someone clicks
    DESKTOP_NOTIFICATION: true, // system notification, shows even if page sound is blocked
    FLASH_BANNER: true, // flashing banner at the top of the page + red outline on the late rows
    FLASH_TITLE: true, // flashing tab title
    HIGHLIGHT_LATE_TIMERS: true, // timers at or past ALERT_AT get a highlighter background until their row is gone
    HIGHLIGHT_COLOR: '#ffe066' // yellow, so it stands out from the dashboard's own red text
  };

  const log = (...a) => console.info('[Watcher]', ...a);
  const LATE_ATTR = 'data-watcher-late';

  if (SETTINGS.HIGHLIGHT_LATE_TIMERS) {
    // GM_addStyle works even on sites whose security settings block added <style> tags
    GM_addStyle(`
      [${LATE_ATTR}] {
        background: ${SETTINGS.HIGHLIGHT_COLOR} !important; font-weight: 700 !important;
        border-radius: 4px !important; padding: 1px 6px !important;
        box-shadow: 0 0 0 2px #1f2328 !important;
      }`);
  }
  const SAME_ROW_SECONDS = 3; // two readings whose start times are this close are the same row

  try {
    document.querySelector(SETTINGS.TIMER);
  } catch {
    console.error('[Watcher] TIMER setting is not a valid selector:', SETTINGS.TIMER);
    return;
  }

  // "04:59" → 299, "1:05:00" → 3900; null if no time found
  const toSeconds = (text) => {
    const m = String(text).match(/(\d+):(\d{2})(?::(\d{2}))?(?!.*\d+:\d{2})/);
    if (!m) return null;
    return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  };
  const LIMIT = toSeconds(SETTINGS.ALERT_AT);
  if (LIMIT === null) {
    console.error('[Watcher] ALERT_AT must look like 05:00 or 1:05:00, got:', SETTINGS.ALERT_AT);
    return;
  }

  // The element to outline and describe: the table row / list item around the timer, if there is one
  const rowOf = (timerEl) =>
    timerEl.closest('tr, [role="row"], li') || timerEl.closest('.procurementListCreatedTime') || timerEl;

  // ---------- Which rows already alerted ----------
  // A row is recognised by when its stopwatch started (now − elapsed), so it still works if the
  // dashboard redraws the rows every second, and rows with different start times are kept apart.
  let alerted = []; // start times (seconds) of rows that already alerted
  let firstScan = true;
  let lastCount = 0;
  let lastLate = 0;

  const scan = () => {
    const nowSec = Date.now() / 1000;
    const timers = document.querySelectorAll(SETTINGS.TIMER);
    const starts = [];
    const reached = [];
    let late = 0;
    const alertedBefore = alerted.slice(); // rows reaching the limit in this same check all count

    for (const el of timers) {
      const secs = toSeconds(el.textContent);
      if (secs === null) continue;
      const start = nowSec - secs;
      starts.push(start);
      // re-applied every second, so it comes back even if the dashboard redraws the row
      if (SETTINGS.HIGHLIGHT_LATE_TIMERS) {
        if (secs >= LIMIT) {
          if (!el.hasAttribute(LATE_ATTR)) el.setAttribute(LATE_ATTR, '');
        } else if (el.hasAttribute(LATE_ATTR)) {
          el.removeAttribute(LATE_ATTR);
        }
      }
      if (secs < LIMIT) continue;
      late++;
      if (alertedBefore.some((s) => Math.abs(s - start) <= SAME_ROW_SECONDS)) continue;
      alerted.push(start);
      if (firstScan && !SETTINGS.ALERT_IF_ALREADY_OVER) continue;
      reached.push({ el: rowOf(el), time: el.textContent.trim(), secs });
    }

    // forget rows that are gone from the page
    alerted = alerted.filter((s) => starts.some((t) => Math.abs(s - t) <= SAME_ROW_SECONDS));
    firstScan = false;
    lastCount = starts.length;
    lastLate = late;

    if (reached.length) alertUser(reached);
    updateStatus();
  };

  // ---------- Built-in alarm: two notes, high-low, repeated ----------
  let ctx = null;
  let alarmUntil = 0;
  const getCtx = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
        ctx.addEventListener('statechange', updateStatus);
      } catch { return null; }
    }
    return ctx;
  };
  const soundReady = () => !!ctx && ctx.state === 'running';

  const alarm = () => {
    const c = getCtx();
    if (!c || Date.now() < alarmUntil) return;
    if (c.state !== 'running') {
      c.resume().catch(() => {});
      log('Alarm skipped: sound is not enabled yet (click the page once).');
      return;
    }
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
    alarmUntil = Date.now() + pairs * 2 * STEP * 1000;
  };

  // ---------- On-page UI: status pill (bottom-left) + banner (top) ----------
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .pill { position: fixed; left: 16px; bottom: 16px; z-index: 2147483646; cursor: pointer;
              font: 600 14px/1.3 system-ui, sans-serif; color: #fff; padding: 10px 14px; border-radius: 999px;
              border: 2px solid #fff; box-shadow: 0 4px 16px rgba(0,0,0,.35); }
      .pill.off { background: #d92d20; }
      .pill.on { background: #2b8a3e; }
      .pill.idle { background: #475467; }
      .banner { position: fixed; left: 0; right: 0; top: 0; z-index: 2147483647; cursor: pointer;
                padding: 14px 16px; text-align: center; color: #fff; background: #d92d20;
                font: 700 20px/1.3 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.4);
                animation: flash 1s steps(1) infinite; }
      .banner[hidden] { display: none; }
      @keyframes flash { 50% { background: #7a1610; } }
      @media (prefers-reduced-motion: reduce) { .banner { animation: none; } }
    </style>
    <div class="banner" hidden></div>
    <div class="pill off"></div>`;
  const pill = shadow.querySelector('.pill');
  const banner = shadow.querySelector('.banner');
  document.documentElement.appendChild(host);

  function updateStatus() {
    if (SETTINGS.SOUND && !soundReady()) {
      pill.className = 'pill off';
      pill.textContent = '🔇 Click anywhere to enable alert sound';
    } else if (!lastCount) {
      pill.className = 'pill idle';
      pill.textContent = '⏱ No timers on the page right now';
    } else {
      pill.className = 'pill on';
      pill.textContent = `⏱ Watching ${lastCount} timer${lastCount === 1 ? '' : 's'}` +
        (lastLate ? ` · ${lastLate} past ${SETTINGS.ALERT_AT}` : '');
    }
    pill.title = 'Click to test the alert';
  }

  // ---------- Alerting ----------
  let pending = false;
  let repeatTimer = null;
  let titleTimer = null;
  let originalTitle = '';
  const highlighted = new Set();

  const highlight = (el) => {
    el.style.setProperty('outline', '3px solid #d92d20', 'important');
    el.style.setProperty('outline-offset', '2px', 'important');
    highlighted.add(el);
  };

  const flashTitle = (msg) => {
    if (titleTimer) return;
    originalTitle = document.title;
    let on = false;
    titleTimer = setInterval(() => {
      on = !on;
      document.title = on ? msg : originalTitle;
    }, 1000);
  };

  const describe = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 150);

  function alertUser(rows) {
    const title = `⏰ ${rows.length} row${rows.length === 1 ? '' : 's'} reached ${SETTINGS.ALERT_AT}`;
    const first = describe(rows[0].el) || rows[0].time;
    log(title, rows.map((r) => `${r.time} | ${describe(r.el)}`));

    if (SETTINGS.FLASH_BANNER) {
      rows.forEach((r) => highlight(r.el));
      banner.textContent = `${title} (click anywhere to dismiss)`;
      banner.hidden = false;
    }
    if (SETTINGS.FLASH_TITLE) flashTitle(title);
    if (SETTINGS.DESKTOP_NOTIFICATION) {
      try {
        GM_notification({ title, text: first, onclick: () => window.focus() });
      } catch (e) { log('Desktop notification failed:', e); }
    }
    if (SETTINGS.SOUND) {
      alarm();
      clearInterval(repeatTimer);
      if (SETTINGS.REPEAT_EVERY_SECONDS > 0) {
        repeatTimer = setInterval(alarm, SETTINGS.REPEAT_EVERY_SECONDS * 1000);
      }
    }
    pending = true;
  }

  const dismiss = () => {
    if (!pending) return;
    pending = false;
    clearInterval(repeatTimer);
    repeatTimer = null;
    clearInterval(titleTimer);
    titleTimer = null;
    if (originalTitle) document.title = originalTitle;
    banner.hidden = true;
    for (const el of highlighted) {
      el.style.removeProperty('outline');
      el.style.removeProperty('outline-offset');
    }
    highlighted.clear();
  };

  const testAlert = () => alertUser([{ el: document.createElement('div'), time: SETTINGS.ALERT_AT, secs: LIMIT }]);

  // Any click or key press: turn sound on (browsers require a tap) and dismiss the current alert
  const onUserAction = () => {
    const c = getCtx();
    if (c && c.state === 'suspended') c.resume().then(updateStatus).catch(() => {});
    dismiss();
  };
  window.addEventListener('pointerdown', onUserAction, true);
  window.addEventListener('keydown', onUserAction, true);
  pill.addEventListener('click', () => setTimeout(testAlert, 50));
  banner.addEventListener('click', dismiss);

  // ---------- Menu (Tampermonkey icon) ----------
  GM_registerMenuCommand('🔔 Test alert', testAlert);
  GM_registerMenuCommand('🔍 Show watched timers (3s)', () => {
    const els = [...document.querySelectorAll(SETTINGS.TIMER)];
    log(`${els.length} timer(s) match ${SETTINGS.TIMER}:`, els.map((el) => el.textContent.trim()));
    els.forEach((el) => el.style.setProperty('outline', '3px dashed #1971c2', 'important'));
    setTimeout(() => els.forEach((el) => el.style.removeProperty('outline')), 3000);
  });

  // ---------- Check every second (the stopwatches tick every second anyway) ----------
  getCtx();
  scan();
  setInterval(scan, 1000);
  log(`Watching ${SETTINGS.TIMER}; alert at ${SETTINGS.ALERT_AT}.`);
})();
