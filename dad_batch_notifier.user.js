// ==UserScript==
// @name         DAD Batch Notifier v1 - by Mohajiho
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Notifies when a new Batch drops on the Operations Dashboard, and continues to notify every 30 seconds if no one accepts the Batch.
// @author       Mohajiho
// @match        *://*.mohsenusa.github.io/*
// @grant        GM_getResourceURL
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

let audioContext = null;
let intervalId = null;
let hasNotified = false;

// Function to create the audio context
function createAudioContext() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return true;
  } catch (error) {
    console.error("Failed to create audio context:", error);
    return false;
  }
}

// Function to play a nice beep notification
function playBeep() {
  if (!createAudioContext()) return;

  try {
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    // Use raw URL of the audio file hosted on GitHub
    const soundUrl = 'https://raw.githubusercontent.com/MohsenUSA/ASSIGNABLE/main/alarm.wav';

    fetch(soundUrl)
      .then(response => response.arrayBuffer())
      .then(buffer => audioContext.decodeAudioData(buffer))
      .then(decodedData => {
        const source = audioContext.createBufferSource();
        source.buffer = decodedData;
        source.connect(audioContext.destination);
        source.start(0);
        console.log("Alarm sound played");
      })
      .catch(error => {
        console.error("Error playing local sound:", error);
      });

  } catch (error) {
    console.error("Audio playback failed:", error);
  }
}

// Function to check for "ASSIGNABLE" and manage notification
function checkAndPlaySound() {
  const found = document.body.textContent.includes("ASSIGNABLE");

  if (found && !hasNotified) {
    // Play sound when ASSIGNABLE is first detected
    playBeep();
    hasNotified = true;
    
    console.log("ASSIGNABLE found! Starting notification interval");

    // Clear any existing interval first to prevent duplicates
    if (intervalId) {
      clearInterval(intervalId);
    }

    // Set up interval to keep notifying every 30 seconds
    intervalId = setInterval(() => {
      if (document.body.textContent.includes("ASSIGNABLE")) {
        playBeep();
        console.log("Repeat notification - ASSIGNABLE still present");
      } else {
        clearInterval(intervalId);
        intervalId = null;
        hasNotified = false;
        console.log("ASSIGNABLE no longer present, stopping notifications");
      }
    }, 30000);
  }

  if (!found && hasNotified) {
    // Clear interval if ASSIGNABLE is no longer present
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    hasNotified = false;
    console.log("ASSIGNABLE disappeared, reset notification state");
  }
}

// Inject a one-time start button to enable audio playback
function injectStartButton() {
  if (document.getElementById('initNotify')) return;

  // Create overlay that blurs the background
  const overlay = document.createElement('div');
  overlay.id = 'initNotifyOverlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    backdropFilter: 'blur(6px)',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    zIndex: '9999'
  });

  // Create the button
  const button = document.createElement('button');
  button.id = 'initNotify';
  button.textContent = 'Start Notifications';
  Object.assign(button.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
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
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
  });

  // Append to document
  document.body.appendChild(overlay);
  document.body.appendChild(button);

  // Click handler
  button.addEventListener('click', () => {
    createAudioContext();
    audioContext.resume().then(() => {
      playBeep();
      overlay.remove();
      button.remove();
      checkAndPlaySound();
    }).catch(err => {
      console.error("Failed to start audio:", err);
      alert("Failed to start audio. Please check your browser settings.");
    });
  });
}

// Observe DOM changes
const observer = new MutationObserver(() => {
  checkAndPlaySound();
});

// Start observing the DOM
function startObserver() {
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  console.log("Batch Notifier observer started");
}

// Initialize the extension
function initialize() {
  injectStartButton();
  startObserver();
}

// Safely initialize when body is ready
if (document.body) {
  initialize();
} else {
  // Fallback in case body is not ready yet
  document.addEventListener('DOMContentLoaded', initialize);
}
