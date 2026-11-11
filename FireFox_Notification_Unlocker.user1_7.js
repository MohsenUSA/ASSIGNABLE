// ==UserScript==
// @name         FireFox Notification Unlocker
// @namespace    local.sound-notification-unlocker
// @version      1.7
// @author       Mohsen Hajihosseinnejad • alias: MOHAJIHO • email: mohajiho@gmail.com
// @description  Unlocks notification sounds and permission in Firefox on the sites in the @match lines. Shows a full-screen prompt and a bell: red when Firefox is blocking sound, green when sound is on. One tap turns sound on.
// @match        *://*.mohsenusa.github.io/*
// @match        *://a.man-dash.b.test.com/*
// @grant        GM_addElement
// @grant        GM_xmlhttpRequest
// @connect      self
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  // Sites: add one "// @match" line per site in the header above.
  // Example covering a domain and its subdomains: // @match        *://*.example.com/*

  // ---------- Settings: true = ON, false = OFF ----------
  const SETTINGS = {
    FULL_SCREEN: true, // full-screen "Tap anywhere to turn on sound" prompt while sound is off
    HIDE_BELL_WHEN_GREEN: false, // hide the corner bell once sound is on
    FIX_SOUND_FILES: true, // if the site's sound file fails to load (e.g. 403), fetch it another way; if that fails too, play the backup alert
    BACKUP_SIREN: true, // backup alert: true = repeating two-note high-low alarm, false = single short chime
    SIREN_SECONDS: 4, // how long the alarm repeats
    SIREN_VOLUME: 0.35 // 0.05 (quiet) to 1 (maximum)
  };

  // ---------- Code that runs inside the page itself (so it can patch the site's audio/notification calls) ----------
  function pageMain(opts) {
    if (window.__soundNotifUnlocker) return;
    window.__soundNotifUnlocker = true;

    const isTop = window.top === window;
    const log = (...a) => console.info('[Unlocker]', ...a);
    const RETRY_WINDOW_MS = 10_000; // only replay sounds blocked in the last 10s
    const blockedMedia = new Map(); // element -> time it was blocked
    const contexts = new Set(); // AudioContexts the site created
    const pendingPermission = []; // resolvers waiting for a tap
    const OrigAC = window.AudioContext || window.webkitAudioContext;
    let asking = null;

    // 1) <audio>/<video>.play(): remember blocked sounds so they can be replayed after a tap
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      const el = this;
      const p = origPlay.apply(el, args);
      if (p && typeof p.catch === 'function') {
        p.catch((err) => {
          if (!err) return;
          if (err.name === 'NotAllowedError') {
            blockedMedia.set(el, Date.now());
            log('Browser blocked a sound; it will play after your next tap.');
            update();
          } else if (opts.fixSounds && (err.name === 'NotSupportedError' || el.error)) {
            repairAndPlay(el); // the sound file itself failed to load
          }
        });
      }
      return p; // keep the site's original behaviour
    };

    // 1b) Sound file failed to load (e.g. server answers 403 to the audio player's request).
    //     Download it with a normal request instead and play that copy; if that fails too, play the backup alert (siren or chime, see Settings).
    const repaired = new Map(); // original URL -> Promise<playable blob: URL, or null>
    const waitingFetch = new Map();
    let fetchId = 0;

    const dataUrlToBlob = (dataUrl) => {
      const [head, b64] = dataUrl.split(',');
      const type = (head.match(/^data:([^;,]+)/) || [])[1] || 'audio/wav';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    };

    // Plan A: the page's own fetch() (sends cookies, no audio-player headers)
    const fetchViaPage = (url) =>
      fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))));

    // Plan B: ask the Tampermonkey side to download it (a request like opening the link in a tab)
    document.addEventListener('unlocker:fetched', (e) => {
      let msg;
      try { msg = JSON.parse(e.detail); } catch { return; }
      const done = waitingFetch.get(msg.id);
      if (done) { waitingFetch.delete(msg.id); done(msg.data); }
    });
    const fetchViaScript = (url) => new Promise((resolve, reject) => {
      const id = ++fetchId;
      waitingFetch.set(id, (data) => (data ? resolve(dataUrlToBlob(data)) : reject(new Error('download failed'))));
      document.dispatchEvent(new CustomEvent('unlocker:fetch', { detail: JSON.stringify({ id, url }) }));
      setTimeout(() => { if (waitingFetch.delete(id)) reject(new Error('timeout')); }, 20_000);
    });

    const getPlayable = (url) => {
      if (!repaired.has(url)) {
        repaired.set(url, fetchViaPage(url)
          .catch((err) => { log('Page download failed (', err.message, '); trying Tampermonkey download.'); return fetchViaScript(url); })
          .then((blob) => URL.createObjectURL(blob))
          .catch(() => null));
      }
      return repaired.get(url);
    };

    const repairAndPlay = (el) => {
      const src = el.currentSrc || el.src;
      if (!src || /^(blob|data):/.test(src) || el.__unlockerRepairing) { backupAlert(); return; }
      el.__unlockerRepairing = true;
      log('Sound file failed to load; fetching it another way:', src);
      getPlayable(src).then((url) => {
        el.__unlockerRepairing = false;
        if (!url) { log('Could not load the sound file; playing the backup alert instead.'); backupAlert(); return; }
        el.src = url;
        origPlay.call(el).catch((err) => {
          if (err && err.name === 'NotAllowedError') { blockedMedia.set(el, Date.now()); update(); }
          else { log('Downloaded sound would not play; playing the backup alert instead.'); backupAlert(); }
        });
      });
    };

    // Start the download early when an on-page sound fails while preloading, so the first notification isn't delayed
    if (opts.fixSounds) {
      window.addEventListener('error', (e) => {
        const t = e.target;
        const isMedia = t instanceof HTMLMediaElement || t instanceof HTMLSourceElement;
        const src = isMedia && (t.currentSrc || t.src);
        if (src && !/^(blob|data):/.test(src)) getPlayable(src);
      }, true);
    }

    // 2) Web Audio: track contexts so suspended ones can be resumed on tap
    for (const name of ['AudioContext', 'webkitAudioContext']) {
      const Orig = window[name];
      if (typeof Orig !== 'function' || Orig.__unlockerWrapped) continue;
      const Wrapped = class extends Orig {
        constructor(...a) {
          super(...a);
          contexts.add(this);
          this.addEventListener('statechange', update);
          if (this.state === 'suspended') update();
        }
      };
      Wrapped.__unlockerWrapped = true;
      try { window[name] = Wrapped; } catch { /* read-only on some pages */ }
    }

    // 3) Notifications: Firefox ignores permission requests made without a tap, so hold them until one
    const N = window.Notification;
    const origReq = N && N.requestPermission ? N.requestPermission.bind(N) : null;
    const hasActivation = () => !!(navigator.userActivation && navigator.userActivation.isActive);

    const askPermission = () => {
      if (!origReq) return Promise.resolve('denied');
      if (N.permission !== 'default') return Promise.resolve(N.permission);
      if (!asking) {
        asking = Promise.resolve(origReq())
          .catch(() => N.permission)
          .finally(() => { asking = null; });
      }
      return asking;
    };

    if (origReq) {
      N.requestPermission = function (cb) {
        const done = (r) => { if (typeof cb === 'function') cb(r); return r; };
        if (N.permission !== 'default' || hasActivation()) return askPermission().then(done);
        log('Site asked for notification permission without a tap; will ask on your next tap.');
        return new Promise((resolve) => pendingPermission.push((r) => resolve(done(r))));
      };
    }

    // 4) On any real tap/keypress: replay blocked sounds, resume audio, ask for held permission
    const unlock = () => {
      const now = Date.now();
      for (const [el, t] of blockedMedia) {
        blockedMedia.delete(el);
        if (now - t <= RETRY_WINDOW_MS && el.paused) origPlay.call(el).catch(() => {});
      }
      for (const ctx of contexts) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      }
      if (pendingPermission.length) {
        const waiting = pendingPermission.splice(0);
        askPermission().then((r) => waiting.forEach((fn) => fn(r)));
      }
      setTimeout(update, 300);
    };
    window.addEventListener('click', unlock, true);
    window.addEventListener('keydown', unlock, true);

    // 5) Is sound allowed right now?
    const audioAllowed = () => {
      if (blockedMedia.size) return false;
      if ([...contexts].some((c) => c.state === 'suspended')) return false;
      if (typeof navigator.getAutoplayPolicy === 'function') {
        return navigator.getAutoplayPolicy('mediaelement') === 'allowed'; // Firefox
      }
      // Chrome/Safari: a fresh AudioContext starts "running" only when sound is allowed
      if (OrigAC) {
        try {
          const probe = new OrigAC();
          const ok = probe.state === 'running';
          probe.close().catch(() => {});
          return ok;
        } catch { /* fall through */ }
      }
      return !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
    };

    // Short two-note chime so the user hears that sound works
    const chime = () => {
      if (!OrigAC) return;
      try {
        const ctx = new OrigAC();
        const t = ctx.currentTime;
        [[880, 0], [1320, 0.12]].forEach(([freq, offset]) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t + offset);
          gain.gain.exponentialRampToValueAtTime(0.3, t + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.35);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t + offset);
          osc.stop(t + offset + 0.4);
        });
        setTimeout(() => ctx.close().catch(() => {}), 800);
      } catch { /* ignore */ }
    };

    // Alarm: two steady notes alternating high-low (like a pager/monitor alarm), repeated.
    // Won't stack if several sounds fail at once.
    let sirenUntil = 0;
    const siren = () => {
      if (!OrigAC || Date.now() < sirenUntil) return;
      try {
        const ctx = new OrigAC();
        const t0 = ctx.currentTime + 0.02;
        const HIGH = 988; // B5
        const LOW = 740; // F#5
        const NOTE = 0.65; // seconds each note sounds
        const STEP = 0.73; // note + short gap
        const pairs = Math.max(1, Math.round(opts.sirenSeconds / (2 * STEP)));
        const vol = Math.min(1, Math.max(0.05, opts.sirenVolume));

        for (let i = 0; i < pairs * 2; i++) {
          const s = t0 + i * STEP;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle'; // clear and firm, without the buzzy edge
          osc.frequency.value = i % 2 ? LOW : HIGH;
          gain.gain.setValueAtTime(0.0001, s);
          gain.gain.exponentialRampToValueAtTime(vol, s + 0.015);
          gain.gain.setValueAtTime(vol, s + NOTE - 0.05);
          gain.gain.exponentialRampToValueAtTime(0.0001, s + NOTE);
          osc.connect(gain).connect(ctx.destination);
          osc.start(s);
          osc.stop(s + NOTE + 0.02);
        }

        const totalMs = pairs * 2 * STEP * 1000;
        sirenUntil = Date.now() + totalMs;
        setTimeout(() => ctx.close().catch(() => {}), totalMs + 300);
      } catch { /* ignore */ }
    };

    const backupAlert = () => (opts.siren ? siren() : chime());
    window.__unlockerTestAlert = backupAlert; // console test: __unlockerTestAlert()

    // 6) The bell (top page only): red = sound blocked, green = sound on.
    //    With the full-screen option on, a blocked state also shows a full-screen "tap anywhere" prompt.
    let root = null;
    let bell = null;
    let label = null;
    let wrap = null;
    let overlay = null;
    let labelTimer = null;
    let overlayTimer = null;
    let wrapTimer = null;
    let lastAllowed = null;

    const BELL_SVG = `
      <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
        <path fill="#fff" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/>
      </svg>`;

    const build = () => {
      root = document.createElement('div');
      const shadow = root.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          .wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
                  display: flex; align-items: center; gap: 10px; font: 600 15px/1.3 system-ui, sans-serif; }
          .bell { width: 60px; height: 60px; border-radius: 50%; border: 3px solid #fff;
                  display: grid; place-items: center; cursor: pointer; padding: 0;
                  box-shadow: 0 4px 16px rgba(0,0,0,.35); transition: background-color .3s; }
          .bell.off { background: #d92d20; animation: pulse 1.6s ease-in-out infinite; }
          .bell.on  { background: #2b8a3e; }
          .label { background: #1f2328; color: #fff; padding: 8px 12px; border-radius: 8px;
                   box-shadow: 0 4px 16px rgba(0,0,0,.3); white-space: nowrap; }
          .label[hidden] { display: none; }
          @keyframes pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(217,45,32,.6), 0 4px 16px rgba(0,0,0,.35); }
            50%      { box-shadow: 0 0 0 14px rgba(217,45,32,0), 0 4px 16px rgba(0,0,0,.35); }
          }
          .wrap[hidden] { display: none; }

          .overlay { position: fixed; inset: 0; z-index: 2147483647; cursor: pointer;
                     display: flex; flex-direction: column; align-items: center; justify-content: center;
                     gap: 24px; padding: 16px; text-align: center; color: #fff;
                     background: rgba(17, 19, 23, .93); backdrop-filter: blur(6px);
                     font: 600 20px/1.4 system-ui, sans-serif; transition: opacity .5s; }
          .overlay[hidden] { display: none; }
          .overlay.fade { opacity: 0; pointer-events: none; }
          .overlay .bell { width: 150px; height: 150px; border-width: 5px; pointer-events: none; }
          .overlay .bell svg { width: 80px; height: 80px; }
          .overlay h1 { margin: 0; font-size: clamp(28px, 6vw, 44px); }
          .overlay p { margin: 0; opacity: .85; }
          .overlay .tap { margin-top: 8px; background: #fff; color: #1f2328; border-radius: 999px;
                          padding: 14px 32px; font-size: 22px; }

          @media (prefers-reduced-motion: reduce) { .bell.off { animation: none; } }
        </style>
        <div class="overlay" role="button" tabindex="0" hidden>
          <div class="bell off">${BELL_SVG}</div>
          <h1 class="title">Sound is off</h1>
          <p class="sub">You won't hear notifications until you turn sound on.</p>
          <div class="tap">Tap anywhere to turn on sound</div>
        </div>
        <div class="wrap">
          <div class="label" hidden></div>
          <button class="bell off" type="button">${BELL_SVG}</button>
        </div>`;
      wrap = shadow.querySelector('.wrap');
      bell = wrap.querySelector('.bell');
      label = wrap.querySelector('.label');
      overlay = shadow.querySelector('.overlay');

      // These taps are themselves the permission: unlock() also runs via the page-wide listener
      // Bell = test the real backup alert (siren if on); full-screen prompt = short chime, since it shows on every page load
      const onTap = (sound) => {
        sound();
        askPermission().then(() => setTimeout(update, 300));
        setTimeout(update, 300);
      };
      bell.addEventListener('click', () => onTap(backupAlert));
      overlay.addEventListener('click', () => onTap(chime));
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(chime); }
      });

      document.documentElement.appendChild(root);
    };

    const showLabel = (text, ms) => {
      clearTimeout(labelTimer);
      label.textContent = text;
      label.hidden = false;
      if (ms) labelTimer = setTimeout(() => { label.hidden = true; }, ms);
    };

    function update() {
      if (!isTop || !document.body) return;
      if (!root) build();
      const allowed = audioAllowed();
      if (allowed === lastAllowed) return;

      bell.className = `bell ${allowed ? 'on' : 'off'}`;
      bell.title = allowed ? 'Sound is on (tap to test the alert)' : 'Sound is off – tap to turn it on';
      bell.setAttribute('aria-label', bell.title);

      clearTimeout(wrapTimer);
      if (allowed) {
        const ms = lastAllowed === false ? 2500 : 1500;
        if (opts.hideWhenGreen && lastAllowed === null) {
          wrap.hidden = true; // sound was already on at page load: never show the bell
        } else {
          showLabel('Sound is on ✓', ms);
          // just turned green: let the user see the confirmation, then hide
          if (opts.hideWhenGreen) wrapTimer = setTimeout(() => { wrap.hidden = true; }, ms);
        }
      } else {
        wrap.hidden = false; // the full-screen prompt (if on) hides it again below
        showLabel('Tap to turn on sound', 0);
      }

      if (opts.fullScreen) setOverlay(allowed);
      lastAllowed = allowed;
    }

    function setOverlay(allowed) {
      clearTimeout(overlayTimer);
      const obell = overlay.querySelector('.bell');
      if (!allowed) {
        obell.className = 'bell off';
        overlay.querySelector('.title').textContent = 'Sound is off';
        overlay.querySelector('.sub').hidden = false;
        overlay.querySelector('.tap').hidden = false;
        overlay.classList.remove('fade');
        overlay.hidden = false;
        wrap.hidden = true;
        overlay.focus({ preventScroll: true });
      } else if (!overlay.hidden) {
        // Turn green, confirm, then fade away to reveal the page (corner bell stays green, unless hidden by option)
        obell.className = 'bell on';
        overlay.querySelector('.title').textContent = 'Sound is on ✓';
        overlay.querySelector('.sub').hidden = true;
        overlay.querySelector('.tap').hidden = true;
        overlayTimer = setTimeout(() => {
          overlay.classList.add('fade');
          clearTimeout(wrapTimer);
          wrap.hidden = opts.hideWhenGreen; // the overlay already showed "Sound is on ✓"
          overlayTimer = setTimeout(() => { overlay.hidden = true; }, 500);
        }, 1200);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', update, { once: true });
    } else {
      update();
    }
    setTimeout(update, 1500); // re-check once the site has set itself up
  }

  // ---------- Download helper for FIX_SOUND_FILES (runs on the Tampermonkey side) ----------
  // Only downloads files from the same site as the page.
  if (SETTINGS.FIX_SOUND_FILES) {
    const reply = (id, data) =>
      document.dispatchEvent(new CustomEvent('unlocker:fetched', { detail: JSON.stringify({ id, data }) }));
    document.addEventListener('unlocker:fetch', (e) => {
      let msg;
      try { msg = JSON.parse(e.detail); } catch { return; }
      let url;
      try { url = new URL(msg.url, location.href); } catch { return reply(msg.id, null); }
      if (url.origin !== location.origin) return reply(msg.id, null);
      GM_xmlhttpRequest({
        method: 'GET',
        url: url.href,
        responseType: 'blob',
        timeout: 15_000,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300 || !r.response) {
            console.info('[Unlocker] Tampermonkey download failed: HTTP', r.status);
            return reply(msg.id, null);
          }
          const fr = new FileReader();
          fr.onload = () => reply(msg.id, fr.result);
          fr.onerror = () => reply(msg.id, null);
          fr.readAsDataURL(r.response);
        },
        onerror: () => reply(msg.id, null),
        ontimeout: () => reply(msg.id, null)
      });
    });
  }

  // ---------- Inject into the page before the site's own scripts run ----------
  const code = `(${pageMain})(${JSON.stringify({ fullScreen: SETTINGS.FULL_SCREEN, hideWhenGreen: SETTINGS.HIDE_BELL_WHEN_GREEN, fixSounds: SETTINGS.FIX_SOUND_FILES, siren: SETTINGS.BACKUP_SIREN, sirenSeconds: SETTINGS.SIREN_SECONDS, sirenVolume: SETTINGS.SIREN_VOLUME })});`;
  try {
    GM_addElement(document.documentElement, 'script', { textContent: code }).remove(); // works on strict-CSP sites
  } catch {
    const s = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }
})();
