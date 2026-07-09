// background.js — Service Worker (Manifest V3)
const API_BASE = 'https://app-deiner-wahl.base44.app';

// Tab-Kommunikation: Popup <-> Content Script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SET_TOKEN') {
    chrome.storage.local.set({ extension_token: msg.token }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'GET_TOKEN') {
    chrome.storage.local.get('extension_token', (res) => sendResponse(res));
    return true;
  }

  if (msg.type === 'FETCH_JOBS') {
    chrome.storage.local.get('extension_token', async (res) => {
      try {
        const r = await fetch(`${API_BASE}/api/extension/jobs/queued?limit=1`, {
          headers: { 'Authorization': 'Bearer ' + res.extension_token }
        });
        const jobs = await r.json();
        sendResponse({ jobs });
      } catch (e) { sendResponse({ error: e.message }); }
    });
    return true;
  }

  if (msg.type === 'EXECUTE_JOB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'EXECUTE_CONTACT_REQUEST', payload: msg.payload }, sendResponse);
    });
    return true;
  }
});
