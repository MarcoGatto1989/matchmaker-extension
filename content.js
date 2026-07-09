// content.js — läuft auf LinkedIn-Seiten
let EXTENSION_TOKEN = null;

// Auf Befehle vom Background-Service-Worker hören
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'EXECUTE_CONTACT_REQUEST') {
    sendContactRequest(msg.payload).then(sendResponse);
    return true; // async
  }
  if (msg.type === 'PING') {
    sendResponse({ status: 'ok', url: location.href });
    return true;
  }
});

async function sendContactRequest({ linkedin_url, text_content, job_id, api_base, token }) {
  try {
    // 1) LinkedIn-Profil aufrufen
    window.location.href = linkedin_url;
    await waitForElement('.pv-s-profile-actions--connect', 15000);

    // 2) „Verbinden"-Button klicken
    document.querySelector('.pv-s-profile-actions--connect').click();
    await sleep(2000);

    // 3) „Nachricht hinzufügen"-Option wählen + Text einfügen
    const addNoteBtn = document.querySelector('button[aria-label="Jetzt eine Notiz hinzufügen"]')
      || document.querySelector('button.artdeco-modal__confirm-dialog-btn');
    if (addNoteBtn) {
      addNoteBtn.click();
      await sleep(800);
    }

    const textarea = document.querySelector('textarea.connect-button-send-invite__custom-message');
    if (textarea) {
      textarea.focus();
      textarea.value = text_content;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(500);

    // 4) „Verbinden"-Button im Dialog bestätigen
    const sendBtn = document.querySelector('button[aria-label="Verbinden"]')
      || document.querySelector('.artdeco-button--primary');
    if (sendBtn) sendBtn.click();

    // 5) Ergebnis an die App melden
    await fetch(`${api_base}/api/extension/jobs/${job_id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ status: 'completed' })
    });

  } catch (err) {
    await fetch(`${api_base}/api/extension/jobs/${job_id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ status: 'failed', error: err.message })
    });
  }
}

function waitForElement(selector, timeout) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) { resolve(document.querySelector(selector)); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error('Element nicht gefunden: ' + selector)); }, timeout);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
