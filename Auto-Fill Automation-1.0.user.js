// ==UserScript==
// @name         Auto-Fill Automation
// @namespace    HTTPS://WWW.X.COM/XPRODUCTIVITY
// @version      1.0
// @description  Automated form filler with control panel, progress tracking, and export features
// @author       Mason
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // CONFIGURATION - Edit these settings
  // ═══════════════════════════════════════════════════════════════

  const CONFIG = {
    // Keyboard shortcut to toggle panel (Alt + Shift + A)
    toggleKey: 'A',
    toggleModifiers: { alt: true, shift: true },

    // Default settings
    defaultSelector: 'input#yourInputId',
    defaultDelay: 1500,
    defaultMaxRetries: 10,
    defaultRetryTexts: ['try again', 'please retry', 'error occurred'],

    // Auto-start panel on page load (true/false)
    autoShowPanel: false
  };

  // ═══════════════════════════════════════════════════════════════
  // DO NOT EDIT BELOW THIS LINE (unless you know what you're doing)
  // ═══════════════════════════════════════════════════════════════

  let values = [];
  let inputSelector = CONFIG.defaultSelector;
  let retryTexts = [...CONFIG.defaultRetryTexts];
  let delay = CONFIG.defaultDelay;
  let maxRetries = CONFIG.defaultMaxRetries;

  let isPaused = false;
  let isStopped = false;
  let isRunning = false;
  let currentIndex = 0;
  let logs = [];
  let startTime = null;
  let soundEnabled = true;
  let panelVisible = CONFIG.autoShowPanel;
  let results = {
    successful: [],
    failed: [],
    skipped: []
  };

  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  function playSound(type) {
    if (!soundEnabled) return;
    initAudio();

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    switch(type) {
      case 'success':
        oscillator.frequency.value = 880;
        oscillator.type = 'sine';
        gainNode.gain.value = 0.1;
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1);
        break;
      case 'error':
        oscillator.frequency.value = 220;
        oscillator.type = 'square';
        gainNode.gain.value = 0.1;
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.3);
        break;
        case 'complete': {
            const notes = [523, 659, 784, 1047];
            notes.forEach((freq, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                gain.gain.value = 0.1;
                osc.start(audioCtx.currentTime + i * 0.15);
                osc.stop(audioCtx.currentTime + i * 0.15 + 0.15);
            });
            break;
        }
        case 'retry':
        oscillator.frequency.value = 440;
        oscillator.type = 'triangle';
        gainNode.gain.value = 0.05;
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1);
        break;
      case 'start':
        oscillator.frequency.value = 660;
        oscillator.type = 'sine';
        gainNode.gain.value = 0.1;
        oscillator.start();
        setTimeout(() => {
          const osc2 = audioCtx.createOscillator();
          const gain2 = audioCtx.createGain();
          osc2.connect(gain2);
          gain2.connect(audioCtx.destination);
          osc2.frequency.value = 880;
          osc2.type = 'sine';
          gain2.gain.value = 0.1;
          osc2.start();
          osc2.stop(audioCtx.currentTime + 0.1);
        }, 100);
        oscillator.stop(audioCtx.currentTime + 0.1);
        break;
    }
  }

  function createControlPanel() {
    const panel = document.createElement('div');
    panel.id = 'autoFillPanel';
    panel.innerHTML = `
      <style>
        #autoFillPanel {
          position: fixed;
          top: 10px;
          right: 10px;
          background: #1a1a2e;
          color: #eee;
          padding: 15px;
          border-radius: 8px;
          font-family: monospace;
          font-size: 13px;
          z-index: 2147483647;
          width: 400px;
          box-shadow: 0 4px 15px rgba(0,0,0,0.3);
          max-height: 90vh;
          overflow-y: auto;
          display: ${panelVisible ? 'block' : 'none'};
        }
        #autoFillPanel * {
          box-sizing: border-box;
        }
        #autoFillPanel h3 {
          margin: 0 0 10px 0;
          color: #fff;
          font-size: 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #autoFillPanel button {
          padding: 8px 12px;
          margin: 3px 3px 3px 0;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: bold;
          font-size: 11px;
        }
        #autoFillPanel input[type="text"], #autoFillPanel input[type="number"] {
          padding: 6px 10px;
          border: 1px solid #444;
          border-radius: 4px;
          background: #0d0d1a;
          color: #eee;
          font-family: monospace;
          font-size: 12px;
          width: calc(100% - 22px);
          margin: 5px 0;
        }
        #autoFillPanel textarea {
          padding: 8px;
          border: 1px solid #444;
          border-radius: 4px;
          background: #0d0d1a;
          color: #eee;
          font-family: monospace;
          font-size: 11px;
          width: calc(100% - 18px);
          resize: vertical;
        }
        #autoFillPanel label {
          font-size: 11px;
          color: #aaa;
          display: block;
          margin-top: 8px;
        }
        .af-panel-section {
          background: #0d0d1a;
          border-radius: 4px;
          padding: 10px;
          margin: 10px 0;
        }
        .af-panel-section-title {
          font-size: 12px;
          color: #3498db;
          margin-bottom: 8px;
          font-weight: bold;
        }
        #autoFillPanel #pauseBtn { background: #f39c12; color: #000; }
        #autoFillPanel #restartBtn { background: #3498db; color: #fff; }
        #autoFillPanel #stopBtn { background: #e74c3c; color: #fff; }
        #autoFillPanel #startBtn { background: #2ecc71; color: #fff; }
        #autoFillPanel #exportBtn { background: #9b59b6; color: #fff; }
        #autoFillPanel #exportCsvBtn { background: #16a085; color: #fff; }
        #autoFillPanel #soundBtn { background: #1abc9c; color: #fff; }
        #autoFillPanel #pauseBtn:hover { background: #e67e22; }
        #autoFillPanel #restartBtn:hover { background: #2980b9; }
        #autoFillPanel #stopBtn:hover { background: #c0392b; }
        #autoFillPanel #startBtn:hover { background: #27ae60; }
        #autoFillPanel #exportBtn:hover { background: #8e44ad; }
        #autoFillPanel #exportCsvBtn:hover { background: #1abc9c; }
        #autoFillPanel #soundBtn:hover { background: #16a085; }
        #autoFillPanel button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        #autoFillPanel #logBox {
          background: #0d0d1a;
          padding: 10px;
          margin-top: 10px;
          height: 180px;
          overflow-y: auto;
          border-radius: 4px;
          font-size: 11px;
          line-height: 1.5;
        }
        #autoFillPanel #statusBar {
          margin: 10px 0;
          padding: 8px;
          background: #0d0d1a;
          border-radius: 4px;
        }
        #autoFillPanel #progressContainer {
          margin: 10px 0;
          background: #0d0d1a;
          border-radius: 4px;
          padding: 10px;
        }
        #autoFillPanel #progressBar {
          height: 20px;
          background: #2c2c54;
          border-radius: 4px;
          overflow: hidden;
          position: relative;
        }
        #autoFillPanel #progressFill {
          height: 100%;
          background: linear-gradient(90deg, #2ecc71, #27ae60);
          width: 0%;
          transition: width 0.3s ease;
          border-radius: 4px;
        }
        #autoFillPanel #progressText {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          color: #fff;
          text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
        }
        #autoFillPanel #statsBar {
          display: flex;
          justify-content: space-between;
          margin-top: 8px;
          font-size: 11px;
        }
        #autoFillPanel .stat-success { color: #2ecc71; }
        #autoFillPanel .stat-fail { color: #e74c3c; }
        #autoFillPanel .stat-pending { color: #95a5a6; }
        #autoFillPanel #etaBar {
          margin-top: 8px;
          font-size: 11px;
          color: #95a5a6;
        }
        #autoFillPanel .log-success { color: #2ecc71; }
        #autoFillPanel .log-error { color: #e74c3c; }
        #autoFillPanel .log-retry { color: #f39c12; }
        #autoFillPanel .log-info { color: #3498db; }
        #autoFillPanel .log-warn { color: #e67e22; }
        #autoFillPanel .btn-row { margin-bottom: 5px; }
        #autoFillPanel #fileDropZone {
          border: 2px dashed #444;
          border-radius: 4px;
          padding: 15px;
          text-align: center;
          margin: 10px 0;
          transition: all 0.3s;
          cursor: pointer;
        }
        #autoFillPanel #fileDropZone:hover, #autoFillPanel #fileDropZone.dragover {
          border-color: #3498db;
          background: rgba(52, 152, 219, 0.1);
        }
        #autoFillPanel #fileDropZone input {
          display: none;
        }
        #autoFillPanel #valueCount {
          font-size: 11px;
          color: #2ecc71;
          margin-top: 5px;
        }
        #autoFillPanel .settings-row {
          display: flex;
          gap: 10px;
          margin: 5px 0;
        }
        #autoFillPanel .settings-row > div {
          flex: 1;
        }
        #autoFillPanel .collapsible {
          cursor: pointer;
          user-select: none;
        }
        #autoFillPanel .collapsible::before {
          content: '▼ ';
          font-size: 10px;
        }
        #autoFillPanel .collapsible.collapsed::before {
          content: '▶ ';
        }
        #autoFillPanel .collapsible-content {
          max-height: 500px;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }
        #autoFillPanel .collapsible-content.collapsed {
          max-height: 0;
        }
        #autoFillPanel #minimizeBtn, #autoFillPanel #closeBtn {
          background: none;
          border: none;
          color: #aaa;
          cursor: pointer;
          font-size: 16px;
          padding: 0 5px;
        }
        #autoFillPanel #minimizeBtn:hover, #autoFillPanel #closeBtn:hover {
          color: #fff;
        }
        #autoFillPanel #liveDelayContainer {
          background: #16213e;
          border-radius: 4px;
          padding: 10px;
          margin: 10px 0;
        }
        #autoFillPanel #liveDelayContainer .slider-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        #autoFillPanel #liveDelayContainer .slider-title {
          font-size: 12px;
          color: #3498db;
          font-weight: bold;
        }
        #autoFillPanel #liveDelayValue {
          background: #0d0d1a;
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 12px;
          color: #2ecc71;
          font-weight: bold;
        }
        #autoFillPanel #delaySlider {
          width: 100%;
          height: 8px;
          -webkit-appearance: none;
          appearance: none;
          background: #2c2c54;
          border-radius: 4px;
          outline: none;
          cursor: pointer;
        }
        #autoFillPanel #delaySlider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          background: #3498db;
          border-radius: 50%;
          cursor: pointer;
          transition: background 0.2s;
        }
        #autoFillPanel #delaySlider::-webkit-slider-thumb:hover {
          background: #2980b9;
        }
        #autoFillPanel #delaySlider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          background: #3498db;
          border-radius: 50%;
          cursor: pointer;
          border: none;
        }
        #autoFillPanel .slider-labels {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: #666;
          margin-top: 5px;
        }
        #autoFillPanel .slider-presets {
          display: flex;
          gap: 5px;
          margin-top: 8px;
        }
        #autoFillPanel .slider-presets button {
          flex: 1;
          padding: 5px;
          font-size: 10px;
          background: #2c2c54;
          color: #aaa;
        }
        #autoFillPanel .slider-presets button:hover {
          background: #3498db;
          color: #fff;
        }
        #autoFillPanel .slider-presets button.active {
          background: #3498db;
          color: #fff;
        }
        #autoFillPanel .shortcut-hint {
          font-size: 10px;
          color: #666;
          text-align: center;
          margin-top: 10px;
        }
      </style>
      <h3>
        <span>⚡ Auto-Fill Panel</span>
        <span style="display:flex;align-items:center;gap:10px;">
          <span id="timer">00:00</span>
          <button id="minimizeBtn" title="Minimize">−</button>
          <button id="closeBtn" title="Close (${CONFIG.toggleModifiers.alt ? 'Alt+' : ''}${CONFIG.toggleModifiers.shift ? 'Shift+' : ''}${CONFIG.toggleKey})">×</button>
        </span>
      </h3>

      <div id="panelContent">
        <div class="af-panel-section">
          <div class="af-panel-section-title collapsible" data-section="data">📋 Data Input</div>
          <div class="collapsible-content" data-section="data">
            <div id="fileDropZone">
              <div>📁 Drop file here or click to browse</div>
              <div style="font-size:10px;color:#888;margin-top:5px;">Supports .txt, .csv, .json</div>
              <input type="file" id="fileInput" accept=".txt,.csv,.json">
            </div>
            <label>Or paste values (one per line):</label>
            <textarea id="valuesInput" rows="4" placeholder="value1&#10;value2&#10;value3"></textarea>
            <div id="valueCount">0 values loaded</div>
          </div>
        </div>

        <div class="af-panel-section">
          <div class="af-panel-section-title collapsible" data-section="settings">⚙️ Settings</div>
          <div class="collapsible-content" data-section="settings">
            <label>Input selector:</label>
            <input type="text" id="selectorInput" value="${CONFIG.defaultSelector}">

            <div class="settings-row">
              <div>
                <label>Initial Delay (ms):</label>
                <input type="number" id="delayInput" value="${CONFIG.defaultDelay}" min="100" step="100">
              </div>
              <div>
                <label>Max retries:</label>
                <input type="number" id="retriesInput" value="${CONFIG.defaultMaxRetries}" min="1" max="50">
              </div>
            </div>

            <label>Retry texts (comma separated):</label>
            <input type="text" id="retryTextsInput" value="${CONFIG.defaultRetryTexts.join(', ')}">
          </div>
        </div>

        <div id="liveDelayContainer">
          <div class="slider-header">
            <span class="slider-title">⏱️ Live Delay Control</span>
            <span id="liveDelayValue">${CONFIG.defaultDelay}ms</span>
          </div>
          <input type="range" id="delaySlider" min="100" max="5000" step="100" value="${CONFIG.defaultDelay}">
          <div class="slider-labels">
            <span>Fast (100ms)</span>
            <span>Slow (5000ms)</span>
          </div>
          <div class="slider-presets">
            <button data-delay="250">250ms</button>
            <button data-delay="500">500ms</button>
            <button data-delay="1000">1s</button>
            <button data-delay="1500" class="active">1.5s</button>
            <button data-delay="2000">2s</button>
            <button data-delay="3000">3s</button>
          </div>
        </div>

        <div id="progressContainer">
          <div id="progressBar">
            <div id="progressFill"></div>
            <div id="progressText">0%</div>
          </div>
          <div id="statsBar">
            <span class="stat-success">✓ <span id="successCount">0</span></span>
            <span class="stat-fail">✗ <span id="failCount">0</span></span>
            <span class="stat-pending">◯ <span id="pendingCount">0</span></span>
          </div>
          <div id="etaBar">ETA: waiting to start...</div>
        </div>

        <div id="statusBar">Status: <span id="statusText">Ready</span></div>

        <div class="btn-row">
          <button id="startBtn">▶ Start</button>
          <button id="pauseBtn" disabled>⏸ Pause</button>
          <button id="restartBtn" disabled>🔄 Restart</button>
          <button id="stopBtn" disabled>⏹ Stop</button>
        </div>
        <div class="btn-row">
          <button id="soundBtn">🔊 Sound: ON</button>
          <button id="exportBtn">📥 Export Log</button>
          <button id="exportCsvBtn">📊 Export CSV</button>
        </div>

        <div id="logBox"></div>

        <div class="shortcut-hint">Press ${CONFIG.toggleModifiers.alt ? 'Alt+' : ''}${CONFIG.toggleModifiers.shift ? 'Shift+' : ''}${CONFIG.toggleKey} to toggle panel</div>
      </div>
    `;
    document.body.appendChild(panel);

    // Event listeners
    panel.querySelector('#startBtn').onclick = start;
    panel.querySelector('#pauseBtn').onclick = togglePause;
    panel.querySelector('#restartBtn').onclick = restart;
    panel.querySelector('#stopBtn').onclick = stop;
    panel.querySelector('#exportBtn').onclick = exportLog;
    panel.querySelector('#exportCsvBtn').onclick = exportCsv;
    panel.querySelector('#soundBtn').onclick = toggleSound;
    panel.querySelector('#minimizeBtn').onclick = toggleMinimize;
    panel.querySelector('#closeBtn').onclick = togglePanel;

    // Collapsible sections
    panel.querySelectorAll('.collapsible').forEach(el => {
      el.onclick = function() {
        this.classList.toggle('collapsed');
        this.nextElementSibling.classList.toggle('collapsed');
      };
    });

    // Live delay slider
    const slider = panel.querySelector('#delaySlider');
    slider.oninput = function() {
      setDelay(parseInt(this.value));
    };

    // Preset buttons
    panel.querySelectorAll('.slider-presets button').forEach(btn => {
      btn.onclick = function() {
        setDelay(parseInt(this.dataset.delay));
      };
    });

    // File input
    const fileInput = panel.querySelector('#fileInput');
    const dropZone = panel.querySelector('#fileDropZone');

    dropZone.onclick = () => fileInput.click();
    fileInput.onchange = (e) => handleFileSelect(e.target.files[0]);

    dropZone.ondragover = (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    };
    dropZone.ondragleave = () => dropZone.classList.remove('dragover');
    dropZone.ondrop = (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    };

    // Values textarea
    panel.querySelector('#valuesInput').oninput = loadValuesFromTextarea;

    // Sync delay input with slider
    panel.querySelector('#delayInput').oninput = function() {
      setDelay(parseInt(this.value) || CONFIG.defaultDelay);
    };
  }

  function togglePanel() {
    const panel = document.getElementById('autoFillPanel');
    if (panel) {
      panelVisible = !panelVisible;
      panel.style.display = panelVisible ? 'block' : 'none';
    }
  }

  function setDelay(ms) {
    delay = Math.max(100, Math.min(5000, ms));

    const slider = document.querySelector('#autoFillPanel #delaySlider');
    if (slider) slider.value = delay;

    const display = document.querySelector('#autoFillPanel #liveDelayValue');
    if (display) {
      display.textContent = delay >= 1000 ? `${(delay/1000).toFixed(1)}s` : `${delay}ms`;
    }

    const input = document.querySelector('#autoFillPanel #delayInput');
    if (input) input.value = delay;

    document.querySelectorAll('#autoFillPanel .slider-presets button').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.delay) === delay);
    });

    if (isRunning) {
      log(`Delay adjusted to ${delay}ms`, 'info');
    }
  }

  function toggleMinimize() {
    const content = document.querySelector('#autoFillPanel #panelContent');
    const btn = document.querySelector('#autoFillPanel #minimizeBtn');
    if (content.style.display === 'none') {
      content.style.display = 'block';
      btn.textContent = '−';
    } else {
      content.style.display = 'none';
      btn.textContent = '+';
    }
  }

  function handleFileSelect(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      const content = e.target.result;
      let parsedValues = [];

      if (file.name.endsWith('.json')) {
        try {
          const json = JSON.parse(content);
          if (Array.isArray(json)) {
            parsedValues = json.map(v => String(v).trim());
          } else if (typeof json === 'object') {
            parsedValues = Object.values(json).map(v => String(v).trim());
          }
        } catch (err) {
          log('Error parsing JSON file', 'error');
          return;
        }
      } else if (file.name.endsWith('.csv')) {
        const lines = content.split('\n');
        parsedValues = lines.map(line => {
          const cols = line.split(',');
          return cols[0].replace(/^["']|["']$/g, '').trim();
        });
      } else {
        parsedValues = content.split('\n').map(v => v.trim());
      }

      values = parsedValues.filter(v => v.length > 0);
      document.querySelector('#autoFillPanel #valuesInput').value = values.join('\n');
      updateValueCount();
      log(`Loaded ${values.length} values from ${file.name}`, 'success');
      playSound('success');
    };
    reader.readAsText(file);
  }

  function loadValuesFromTextarea() {
    const text = document.querySelector('#autoFillPanel #valuesInput').value;
    values = text.split('\n').map(v => v.trim()).filter(v => v.length > 0);
    updateValueCount();
  }

  function updateValueCount() {
    document.querySelector('#autoFillPanel #valueCount').textContent = `${values.length} values loaded`;
    document.querySelector('#autoFillPanel #pendingCount').textContent = values.length;
  }

  function loadSettings() {
    inputSelector = document.querySelector('#autoFillPanel #selectorInput').value;
    delay = parseInt(document.querySelector('#autoFillPanel #delayInput').value) || CONFIG.defaultDelay;
    maxRetries = parseInt(document.querySelector('#autoFillPanel #retriesInput').value) || CONFIG.defaultMaxRetries;
    retryTexts = document.querySelector('#autoFillPanel #retryTextsInput').value.split(',').map(t => t.trim());
    setDelay(delay);
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    const btn = document.querySelector('#autoFillPanel #soundBtn');
    btn.textContent = soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
    btn.style.background = soundEnabled ? '#1abc9c' : '#7f8c8d';
    log(`Sound ${soundEnabled ? 'enabled' : 'disabled'}`, 'info');
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function updateTimer() {
    if (!startTime || isStopped) return;
    const elapsed = (Date.now() - startTime) / 1000;
    document.querySelector('#autoFillPanel #timer').textContent = formatTime(elapsed);
  }

  function updateProgress() {
    const total = values.length;
    const processed = results.successful.length + results.failed.length;
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

    document.querySelector('#autoFillPanel #progressFill').style.width = `${percent}%`;
    document.querySelector('#autoFillPanel #progressText').textContent = `${percent}% (${processed}/${total})`;
    document.querySelector('#autoFillPanel #successCount').textContent = results.successful.length;
    document.querySelector('#autoFillPanel #failCount').textContent = results.failed.length;
    document.querySelector('#autoFillPanel #pendingCount').textContent = total - processed;

    if (processed > 0 && startTime) {
      const elapsed = (Date.now() - startTime) / 1000;
      const avgTimePerItem = elapsed / processed;
      const remaining = total - processed;
      const eta = remaining * avgTimePerItem;
      document.querySelector('#autoFillPanel #etaBar').textContent = `ETA: ${formatTime(eta)} remaining`;
    }
  }

  function log(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const logEntry = { time, message, type };
    logs.push(logEntry);

    const logBox = document.querySelector('#autoFillPanel #logBox');
    if (logBox) {
      logBox.innerHTML += `<div class="log-${type}">[${time}] ${message}</div>`;
      logBox.scrollTop = logBox.scrollHeight;
    }
    console.log(`[AutoFill][${type.toUpperCase()}] ${message}`);
  }

  function updateStatus(text) {
    const statusText = document.querySelector('#autoFillPanel #statusText');
    if (statusText) statusText.textContent = text;
  }

  function setButtonStates(running) {
    const panel = document.getElementById('autoFillPanel');
    panel.querySelector('#startBtn').disabled = running;
    panel.querySelector('#pauseBtn').disabled = !running;
    panel.querySelector('#restartBtn').disabled = !running;
    panel.querySelector('#stopBtn').disabled = !running;
    panel.querySelector('#selectorInput').disabled = running;
    panel.querySelector('#retriesInput').disabled = running;
    panel.querySelector('#retryTextsInput').disabled = running;
    panel.querySelector('#valuesInput').disabled = running;
    panel.querySelector('#fileInput').disabled = running;
  }

  function start() {
    loadValuesFromTextarea();
    loadSettings();

    if (values.length === 0) {
      log('No values to process. Please load or paste values first.', 'error');
      playSound('error');
      return;
    }

    const input = document.querySelector(inputSelector);
    if (!input) {
      log(`Input not found: ${inputSelector}`, 'error');
      playSound('error');
      return;
    }

    isRunning = true;
    isStopped = false;
    isPaused = false;
    currentIndex = 0;
    results = { successful: [], failed: [], skipped: [] };
    logs = [];
    document.querySelector('#autoFillPanel #logBox').innerHTML = '';

    setButtonStates(true);
    playSound('start');
    autoFill();
  }

  function togglePause() {
    isPaused = !isPaused;
    const btn = document.querySelector('#autoFillPanel #pauseBtn');
    if (isPaused) {
      btn.textContent = '▶ Resume';
      btn.style.background = '#2ecc71';
      updateStatus('Paused');
      log('Paused by user', 'warn');
    } else {
      btn.textContent = '⏸ Pause';
      btn.style.background = '#f39c12';
      updateStatus('Running');
      log('Resumed by user', 'info');
      playSound('start');
    }
  }

  function restart() {
    isStopped = true;
    setTimeout(() => {
      isStopped = false;
      isPaused = false;
      currentIndex = 0;
      results = { successful: [], failed: [], skipped: [] };
      logs = [];
      startTime = Date.now();
      document.querySelector('#autoFillPanel #logBox').innerHTML = '';
      const pauseBtn = document.querySelector('#autoFillPanel #pauseBtn');
      pauseBtn.textContent = '⏸ Pause';
      pauseBtn.style.background = '#f39c12';
      document.querySelector('#autoFillPanel #progressFill').style.width = '0%';
      document.querySelector('#autoFillPanel #progressText').textContent = '0%';
      log('Restarted from beginning', 'info');
      updateProgress();
      playSound('start');
      autoFill();
    }, 100);
  }

  function stop() {
    isStopped = true;
    isPaused = false;
    isRunning = false;
    updateStatus('Stopped');
    log('Stopped by user', 'error');
    setButtonStates(false);
    showReport();
    playSound('error');
  }

  function exportLog() {
    const total = values.length;
    const successCount = results.successful.length;
    const failCount = results.failed.length;
    const skippedCount = results.skipped.length;
    const elapsed = startTime ? formatTime((Date.now() - startTime) / 1000) : 'N/A';

    let content = `AUTO-FILL LOG REPORT\n`;
    content += `Generated: ${new Date().toLocaleString()}\n`;
    content += `Duration: ${elapsed}\n`;
    content += `URL: ${window.location.href}\n`;
    content += `═══════════════════════════════════════\n\n`;

    content += `SETTINGS\n`;
    content += `───────────────────────────────────────\n`;
    content += `Input selector: ${inputSelector}\n`;
    content += `Delay: ${delay}ms\n`;
    content += `Max retries: ${maxRetries}\n`;
    content += `Retry texts: ${retryTexts.join(', ')}\n\n`;

    content += `SUMMARY\n`;
    content += `───────────────────────────────────────\n`;
    content += `Total values: ${total}\n`;
    content += `Successful: ${successCount}\n`;
    content += `Failed: ${failCount}\n`;
    content += `Skipped: ${skippedCount}\n\n`;

    content += `SUCCESSFUL VALUES\n`;
    content += `───────────────────────────────────────\n`;
    content += results.successful.length > 0
      ? results.successful.map(v => `  ✓ ${v}`).join('\n')
      : '  (none)';
    content += '\n\n';

    content += `FAILED VALUES\n`;
    content += `───────────────────────────────────────\n`;
    content += results.failed.length > 0
      ? results.failed.map(v => `  ✗ ${v}`).join('\n')
      : '  (none)';
    content += '\n\n';

    content += `SKIPPED VALUES\n`;
    content += `───────────────────────────────────────\n`;
    content += results.skipped.length > 0
      ? results.skipped.map(v => `  ⊘ ${v}`).join('\n')
      : '  (none)';
    content += '\n\n';

    content += `DETAILED LOG\n`;
    content += `═══════════════════════════════════════\n`;
    content += logs.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');

    downloadFile(content, `autofill-log-${Date.now()}.txt`, 'text/plain');
    log('Log exported as TXT', 'success');
    playSound('success');
  }

  function exportCsv() {
    let csv = 'Value,Status,Attempts\n';

    results.successful.forEach(v => {
      csv += `"${v.replace(/"/g, '""')}",Success,\n`;
    });

    results.failed.forEach(v => {
      csv += `"${v.replace(/"/g, '""')}",Failed,${maxRetries}\n`;
    });

    results.skipped.forEach(v => {
      csv += `"${v.replace(/"/g, '""')}",Skipped,0\n`;
    });

    downloadFile(csv, `autofill-results-${Date.now()}.csv`, 'text/csv');
    log('Results exported as CSV', 'success');
    playSound('success');
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function waitWhilePaused() {
    while (isPaused && !isStopped) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  function needsRetry() {
    const pageText = document.body.innerText.toLowerCase();
    const found = retryTexts.find(text => pageText.includes(text.toLowerCase()));
    return found || null;
  }

  function showReport() {
    const total = values.length;
    const successCount = results.successful.length;
    const failCount = results.failed.length;
    const skippedCount = results.skipped.length;
    const processed = successCount + failCount;
    const elapsed = startTime ? formatTime((Date.now() - startTime) / 1000) : 'N/A';

    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📊 FINAL REPORT', 'info');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log(`Duration: ${elapsed}`, 'info');
    log(`Total values: ${total}`, 'info');
    log(`Processed: ${processed}`, 'info');
    log(`✓ Successful: ${successCount}`, 'success');
    log(`✗ Failed: ${failCount}`, failCount > 0 ? 'error' : 'success');
    log(`⊘ Skipped: ${skippedCount}`, skippedCount > 0 ? 'warn' : 'info');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

    if (results.successful.length > 0) {
      log('Successful values:', 'success');
      results.successful.forEach(v => log(`  ✓ ${v}`, 'success'));
    }

    if (results.failed.length > 0) {
      log('Failed values:', 'error');
      results.failed.forEach(v => log(`  ✗ ${v}`, 'error'));
    }

    if (results.skipped.length > 0) {
      log('Skipped values:', 'warn');
      results.skipped.forEach(v => log(`  ⊘ ${v}`, 'warn'));
    }

    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('Use "Export Log" or "Export CSV" to save results', 'info');

    console.table({
      'Duration': elapsed,
      'Total': total,
      'Processed': processed,
      'Successful': successCount,
      'Failed': failCount,
      'Skipped': skippedCount
    });
    console.log('Detailed results:', results);
  }

  async function autoFill() {
    const input = document.querySelector(inputSelector);

    if (!input) {
      log(`Input not found: ${inputSelector}`, 'error');
      updateStatus('Error: Input not found');
      playSound('error');
      return;
    }

    startTime = Date.now();

    const timerInterval = setInterval(updateTimer, 1000);

    log(`Starting auto-fill with ${values.length} values`, 'info');
    log(`Input selector: ${inputSelector}`, 'info');
    log(`Delay: ${delay}ms | Max retries: ${maxRetries}`, 'info');
    log(`Retry texts: ${retryTexts.join(', ')}`, 'info');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    updateStatus('Running');
    updateProgress();

    for (let i = currentIndex; i < values.length; i++) {
      if (isStopped) {
        results.skipped = values.slice(i);
        break;
      }

      await waitWhilePaused();
      if (isStopped) {
        results.skipped = values.slice(i);
        break;
      }

      currentIndex = i;
      const value = values[i].trim();
      let attempts = 0;
      let success = false;

      log(`Processing [${i + 1}/${values.length}]: "${value}"`, 'info');

      while (!success && attempts < maxRetries && !isStopped) {
        await waitWhilePaused();
        if (isStopped) break;

        attempts++;

        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));

        updateStatus(`Running: ${i + 1}/${values.length} (attempt ${attempts})`);

        const currentDelay = delay;
          await new Promise(r => setTimeout(r, currentDelay));

        const retryMessage = needsRetry();
        if (retryMessage) {
          log(`  ↻ Attempt ${attempts}: Detected "${retryMessage}"`, 'retry');
          playSound('retry');
        } else {
          success = true;
          log(`  ✓ Success on attempt ${attempts}`, 'success');
          results.successful.push(value);
          playSound('success');
        }
      }

      if (!success && !isStopped) {
        log(`  ✗ Failed after ${attempts} attempts`, 'error');
        results.failed.push(value);
        playSound('error');
      }

      updateProgress();
    }

    clearInterval(timerInterval);
    updateTimer();

    if (!isStopped) {
      isRunning = false;
      setButtonStates(false);
      updateStatus('Completed');
      document.querySelector('#autoFillPanel #etaBar').textContent = 'Completed!';
      log('Auto-fill completed!', 'success');
      showReport();
      playSound('complete');
    }
  }

  // Keyboard shortcut to toggle panel
    document.addEventListener('keydown', (e) => {
        const modifiersMatch =
              e.altKey === CONFIG.toggleModifiers.alt &&
              e.shiftKey === CONFIG.toggleModifiers.shift;

        if (modifiersMatch && e.code === `Key${CONFIG.toggleKey}`) {
            e.preventDefault();
            togglePanel();
        }
    });

  // Register Tampermonkey menu command
  GM_registerMenuCommand('Toggle Auto-Fill Panel', togglePanel);
  // Initialize
  createControlPanel();
  console.log(`[AutoFill] Panel initialized. Press ${CONFIG.toggleModifiers.alt ? 'Alt+' : ''}${CONFIG.toggleModifiers.shift ? 'Shift+' : ''}${CONFIG.toggleKey} to toggle.`);

})();