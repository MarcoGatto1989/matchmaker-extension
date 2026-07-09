// content.js — läuft auf LinkedIn-Seiten
// Führt die LinkedIn-Kontaktanfragen aus

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'EXECUTE_CONTACT_REQUEST') {
    sendContactRequest(msg.payload)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
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
    if (!location.href.includes(linkedin_url.replace('https://linkedin.com', '').replace('https://www.linkedin.com', ''))) {
      window.location.href = linkedin_url;
      await waitForPageLoad(10000);
    }

    // 2) „Verbinden"-Button finden und klicken
    const connectBtn = await findConnectButton(15000);
    if (!connectBtn) {
      throw new Error('Verbinden-Button nicht gefunden');
    }
    connectBtn.click();
    await sleep(2000);

    // 3) „Nachricht hinzufügen" wählen + Text einfügen
    if (text_content) {
      const addNoteBtn = findElement([
        'button[aria-label="Nachricht hinzufügen"]',
        'button[aria-label="Jetzt eine Notiz hinzufügen"]',
        'button[aria-label="Add a note"]',
        'button.artdeco-modal__confirm-dialog-btn',
      ]);
      if (addNoteBtn) {
        addNoteBtn.click();
        await sleep(1000);
      }

      const textarea = findElement([
        'textarea#custom-message',
        'textarea.connect-button-send-invite__custom-message',
        'textarea[name="message"]',
        '.send-invite__custom-message textarea',
      ]);
      if (textarea) {
        textarea.focus();
        textarea.value = '';
        // Simulate real typing for LinkedIn detection
        for (const char of text_content) {
          textarea.value += char;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await sleep(300);
      }
    }

    await sleep(500);

    // 4) Senden-Button bestätigen
    const sendBtn = findElement([
      'button[aria-label="Einladung senden"]',
      'button[aria-label="Send invitation"]',
      'button[aria-label="Verbinden"]',
      'button[aria-label="Send now"]',
      '.artdeco-modal .artdeco-button--primary',
    ]);
    if (sendBtn) {
      sendBtn.click();
    } else {
      throw new Error('Senden-Button nicht gefunden');
    }

    await sleep(1500);

    // 5) Erfolg an Backend melden
    await reportCompletion(api_base, job_id, token, 'completed', null);
    return { success: true };

  } catch (err) {
    console.error('[BOOT] Fehler:', err.message);
    await reportCompletion(api_base, job_id, token, 'failed', err.message);
    return { success: false, error: err.message };
  }
}

async function reportCompletion(api_base, job_id, token, status, error) {
  try {
    await fetch(`${api_base}/api/extension/jobs/${job_id}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ status, error }),
    });
  } catch (e) {
    console.error('[BOOT] Reporting failed:', e.message);
  }
}

function findElement(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

async function findConnectButton(timeout) {
  const selectors = [
    'button.pv-s-profile-actions--connect',
    'button[aria-label*="einladen"]',
    'button[aria-label*="Verbinden"]',
    'button[aria-label*="Connect"]',
    'button[aria-label*="connect"]',
  ];

  const start = Date.now();
  while (Date.now() - start < timeout) {
    // Also check "Mehr"-Menü for hidden connect button
    const moreBtn = document.querySelector('button[aria-label="Mehr"]') ||
                    document.querySelector('button[aria-label="More"]');
    if (moreBtn) {
      moreBtn.click();
      await sleep(500);
    }

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }

    // Also search by text content
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === 'verbinden' || text === 'connect') {
        return btn;
      }
    }

    await sleep(1000);
  }
  return null;
}

function waitForPageLoad(timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (document.readyState === 'complete' || Date.now() - start > timeout) {
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    setTimeout(check, 2000); // Wait at least 2s for navigation
  });
}

function waitForElement(selector, timeout) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { resolve(found); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error('Element nicht gefunden: ' + selector)); }, timeout);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
