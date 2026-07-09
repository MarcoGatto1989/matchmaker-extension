// popup.js — MatchMaker BOOT Extension v2
const tokenInput = document.getElementById('token');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');
const badgeEl = document.getElementById('badge');
const badgeText = document.getElementById('badge-text');
const queuedEl = document.getElementById('queued');
const completedEl = document.getElementById('completed');
const todayEl = document.getElementById('today');
const activeStatusEl = document.getElementById('active-status');
const activeHoursEl = document.getElementById('active-hours');
const dailyLimitEl = document.getElementById('daily-limit');

// Load token
chrome.runtime.sendMessage({ type: 'GET_TOKEN' }, (res) => {
  if (res?.extension_token) {
    tokenInput.value = res.extension_token;
  }
});

// Fetch status
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  if (res?.connected) {
    badgeEl.className = 'connection-badge connected';
    badgeText.textContent = 'Verbunden';

    if (res.stats) {
      queuedEl.textContent = res.stats.queued || 0;
      completedEl.textContent = res.stats.completed || 0;
    }
    todayEl.textContent = res.dailyCount || 0;

    if (res.isActive) {
      activeStatusEl.textContent = '🟢 Aktiv';
      activeStatusEl.style.color = '#22c55e';
    } else {
      activeStatusEl.textContent = '🔴 Pausiert';
      activeStatusEl.style.color = '#ef4444';
    }

    if (res.config) {
      activeHoursEl.textContent = `${res.config.active_hours_start} – ${res.config.active_hours_end}`;
      dailyLimitEl.textContent = `${res.dailyCount || 0} / ${res.config.daily_limit}`;
    }
  } else {
    badgeEl.className = 'connection-badge disconnected';
    badgeText.textContent = 'Nicht verbunden';
    if (res?.error) {
      statusEl.textContent = 'Fehler: ' + res.error;
    }
  }
});

// Save token
saveBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  if (!token) {
    statusEl.textContent = '⚠️ Bitte Token eingeben';
    return;
  }
  saveBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'SET_TOKEN', token }, () => {
    statusEl.textContent = '✅ Token gespeichert!';
    saveBtn.disabled = false;
    // Refresh status after a short delay
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
        if (res?.connected) {
          badgeEl.className = 'connection-badge connected';
          badgeText.textContent = 'Verbunden';
          statusEl.textContent = '✅ Verbindung erfolgreich!';
        } else {
          badgeEl.className = 'connection-badge disconnected';
          badgeText.textContent = 'Nicht verbunden';
          statusEl.textContent = '❌ Token ungültig oder Server nicht erreichbar';
        }
      });
    }, 2000);
  });
});
