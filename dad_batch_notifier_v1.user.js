// ==UserScript==
// @name         DAD Batch Notifier v1 (Using Google Chrome recommended for natural audio!)
// @namespace    http://tampermonkey.net/
// @version      1
// @description  Tracks dropped batches and speaks using natural Google voice (Emma, Jenny, or fallback). Logs to console with timestamps for debugging purposes. By Mohajiho.
// @author       Mohsen Hajihosseinnejad Alias: MOHAJIHO Email: mohajiho@gmail.com
// @match        *://*.mohsenusa.github.io/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  const DEBUG = true;
  function log(...args) {
    if (!DEBUG) return;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: true });
    console.log(`[${ts}] [BATCH DEBUG]`, ...args);
  }

  // -- speech setup --
  let selectedVoice = null;
  let voiceResolved = false;
  function speak(text) {
    function speakNow() {
      if (!voiceResolved) {
        const voices = speechSynthesis.getVoices();
        selectedVoice =
          voices.find(v => v.name === 'en-US-Wavenet-F') || // Emma
          voices.find(v => v.name === 'en-US-Wavenet-C') || // Jenny
          voices.find(v => v.name === 'Google US English' && v.lang === 'en-US');
        voiceResolved = true;
        log(selectedVoice
            ? `✅ Voice selected: ${selectedVoice.name}`
            : "❌ No natural Google voice found. Falling back to default."
        );
      }
      const u = new SpeechSynthesisUtterance(text);
      if (selectedVoice) {
        u.voice = selectedVoice;
        u.lang  = selectedVoice.lang;
      } else {
        u.lang = 'en-US';
      }
      u.rate = 1;
      u.pitch= 1;
      u.volume = 1;
      speechSynthesis.speak(u);
    }
    if (speechSynthesis.getVoices().length) {
      speakNow();
    } else {
      speechSynthesis.onvoiceschanged = () => speakNow();
    }
  }

  // -- state machine for ASSIGNABLE batches --
  let state = 'idle';           // 'idle' | 'pending' | 'active'
  let startTimeout = null;
  let intervalId    = null;

  function checkBatch() {
    const all = Array.from(document.querySelectorAll('*'));
    const count = all.filter(el => el.textContent.trim() === 'ASSIGNABLE').length;
    log(`checkBatch: state=${state}, count=${count}`);

    switch(state) {
      case 'idle':
        if (count > 0) {
          state = 'pending';
          log('Detected ASSIGNABLE(s) → pending confirmation in 5s');
          startTimeout = setTimeout(() => {
            startTimeout = null;
            const still = Array.from(document.querySelectorAll('*'))
                              .filter(el => el.textContent.trim() === 'ASSIGNABLE')
                              .length;
            if (state === 'pending' && still > 0) {
              state = 'active';
              speak("There's a Batch!");
              log('Batch confirmed; entering active reminders');
              intervalId = setInterval(() => {
                speak("Reminder: There's a Batch!");
                log('30s reminder');
              }, 30000);
            } else {
              // disappeared during wait
              log('Batch disappeared before confirmation; returning to idle');
              state = 'idle';
            }
          }, 5000);
        }
        break;

      case 'pending':
        if (count === 0) {
          // user cleared before 5s
          clearTimeout(startTimeout);
          startTimeout = null;
          state = 'idle';
          log('ASSIGNABLE cleared before confirmation; back to idle');
        }
        // else still waiting — do nothing
        break;

      case 'active':
        if (count === 0) {
          // last batch removed
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
          state = 'idle';
          speak("Thank you...");
          log('All ASSIGNABLEs gone; thanked user and reset to idle');
        }
        // else still active — do nothing (reminders keep running)
        break;
    }
  }

  // -- MutationObserver with debounce --
  let debounce = null;
  const observer = new MutationObserver(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(checkBatch, 300);
  });

  function startObserver() {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    log('MutationObserver started.');
  }

  // -- start button injection --
  function injectStartButton() {
    if (document.getElementById('initNotify')) return;

    const overlay = document.createElement('div');
    overlay.id = 'initNotifyOverlay';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100%', height: '100%',
      backdropFilter: 'blur(6px)',
      backgroundColor: 'rgba(0,0,0,0.2)',
      zIndex: '9999'
    });

    const btn = document.createElement('button');
    btn.id = 'initNotify';
    btn.textContent = 'Start Notifications';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: '10000',
      padding: '12px 20px',
      fontSize: '16px',
      fontWeight: 'bold',
      backgroundColor: '#2b8a3e',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
    });

    document.body.appendChild(overlay);
    document.body.appendChild(btn);

    btn.addEventListener('click', () => {
      speechSynthesis.cancel();
      speak("Speech notifications enabled");
      log('User started notifications');
      overlay.remove();
      btn.remove();
      startObserver();
    });
  }

  function initialize() {
    log('Initializing Batch Notifier...');
    injectStartButton();
  }

  if (document.body) initialize();
  else document.addEventListener('DOMContentLoaded', initialize);
})();
