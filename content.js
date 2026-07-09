// content.js — MatchMaker BOOT Extension v3
// Runs on LinkedIn & Xing pages
// Supports: 1) Profile scraping/import to CRM  2) Outreach automation

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'EXECUTE_CONTACT_REQUEST') {
    sendContactRequest(msg.payload)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (msg.type === 'SCRAPE_PROFILE') {
    scrapeCurrentProfile()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (msg.type === 'PING') {
    sendResponse({ status: 'ok', url: location.href, platform: detectPlatform() });
    return true;
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PROFILE SCRAPING — LinkedIn & Xing
// ═══════════════════════════════════════════════════════════════════════

function detectPlatform() {
  if (location.hostname.includes('linkedin.com')) return 'linkedin';
  if (location.hostname.includes('xing.com')) return 'xing';
  return 'unknown';
}

async function scrapeCurrentProfile() {
  const platform = detectPlatform();
  if (platform === 'linkedin') return scrapeLinkedInProfile();
  if (platform === 'xing') return scrapeXingProfile();
  return { success: false, error: 'Nicht auf LinkedIn oder Xing' };
}

function scrapeLinkedInProfile() {
  try {
    const data = {};
    
    // Full name
    const nameEl = document.querySelector('h1.text-heading-xlarge') 
      || document.querySelector('.pv-top-card--list h1')
      || document.querySelector('[data-anonymize="person-name"]');
    if (nameEl) {
      const fullName = nameEl.textContent.trim();
      const parts = fullName.split(/\s+/);
      // Check for academic title
      const titles = ['Dr.', 'Prof.', 'Dipl.', 'RA', 'StB', 'WP'];
      let titleParts = [];
      let nameParts = [];
      for (const p of parts) {
        if (titles.some(t => p.startsWith(t))) {
          titleParts.push(p);
        } else {
          nameParts.push(p);
        }
      }
      data.academicTitle = titleParts.join(' ') || null;
      data.firstName = nameParts.slice(0, -1).join(' ') || '';
      data.lastName = nameParts[nameParts.length - 1] || '';
    }

    // Current position / headline
    const headlineEl = document.querySelector('.text-body-medium.break-words')
      || document.querySelector('.pv-top-card--list .text-body-medium');
    if (headlineEl) {
      data.currentPosition = headlineEl.textContent.trim();
    }

    // Company (from experience section or top card)
    const companyEl = document.querySelector('.pv-text-details__right-panel-item-text')
      || document.querySelector('[data-anonymize="company-name"]');
    if (companyEl) {
      data.currentCompany = companyEl.textContent.trim();
    }
    // Try experience section for more detail
    const expSection = document.querySelector('#experience ~ .pvs-list__outer-container');
    if (expSection) {
      const firstExp = expSection.querySelector('.pvs-entity__path-node ~ div');
      if (firstExp) {
        const expCompany = firstExp.querySelector('.t-bold span') 
          || firstExp.querySelector('[data-anonymize="company-name"]');
        if (expCompany && !data.currentCompany) {
          data.currentCompany = expCompany.textContent.trim();
        }
      }
    }

    // Location
    const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words')
      || document.querySelector('.pv-top-card--list-bullet .text-body-small');
    if (locationEl) {
      const loc = locationEl.textContent.trim();
      data.companyCity = loc.split(',')[0]?.trim() || loc;
    }

    // Profile photo
    const photoEl = document.querySelector('.pv-top-card-profile-picture__image--show')
      || document.querySelector('.profile-photo-edit__preview');
    if (photoEl) {
      data.profilePhoto = photoEl.src || null;
    }

    // Profile URL
    data.linkedInUrl = location.href.split('?')[0];

    // Wechselbereitschaft / Open to Work
    const openToWorkEl = document.querySelector('.pv-top-card--open-to-work')
      || document.querySelector('[class*="open-to-work"]');
    if (openToWorkEl) {
      data.availability = 'Offen für Angebote';
    }

    // Contact info (if accessible)
    const contactSection = document.querySelector('.pv-contact-info');
    if (contactSection) {
      const emailEl = contactSection.querySelector('a[href^="mailto:"]');
      if (emailEl) data.email = emailEl.textContent.trim();
      const phoneEl = contactSection.querySelector('.t-14.t-black.t-normal');
      if (phoneEl) data.phone = phoneEl.textContent.trim();
    }

    // Detect Berufsexamen from headline, about, or experience
    data.berufsexamen = detectBerufsexamen(document.body.innerText);

    // About section for additional context
    const aboutEl = document.querySelector('#about ~ .pvs-list__outer-container .inline-show-more-text');
    if (aboutEl) {
      const aboutText = aboutEl.textContent.trim();
      // Look for Wechselbereitschaft signals
      if (/wechselbereit|offen für|neue herausforderung|suche.*position/i.test(aboutText)) {
        data.availability = data.availability || 'Wechselbereitschaft signalisiert';
      }
    }

    data.sourceChannel = 'LinkedIn';
    return { success: true, data, platform: 'linkedin' };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

function scrapeXingProfile() {
  try {
    const data = {};

    // Name
    const nameEl = document.querySelector('[data-qa="profile-name"]')
      || document.querySelector('.profile-info h1')
      || document.querySelector('.EntityInfo-entity-name');
    if (nameEl) {
      const fullName = nameEl.textContent.trim();
      const parts = fullName.split(/\s+/);
      const titles = ['Dr.', 'Prof.', 'Dipl.', 'RA', 'StB', 'WP'];
      let titleParts = [];
      let nameParts = [];
      for (const p of parts) {
        if (titles.some(t => p.startsWith(t))) {
          titleParts.push(p);
        } else {
          nameParts.push(p);
        }
      }
      data.academicTitle = titleParts.join(' ') || null;
      data.firstName = nameParts.slice(0, -1).join(' ') || '';
      data.lastName = nameParts[nameParts.length - 1] || '';
    }

    // Position
    const posEl = document.querySelector('[data-qa="profile-occupation"]')
      || document.querySelector('.EntityInfo-entity-occupation');
    if (posEl) data.currentPosition = posEl.textContent.trim();

    // Company
    const compEl = document.querySelector('[data-qa="profile-company"]')
      || document.querySelector('.EntityInfo-entity-company');
    if (compEl) data.currentCompany = compEl.textContent.trim();

    // Location
    const locEl = document.querySelector('[data-qa="profile-location"]')
      || document.querySelector('.EntityInfo-entity-location');
    if (locEl) data.companyCity = locEl.textContent.trim();

    // Profile photo
    const photoEl = document.querySelector('.EntityInfo-entity-image img')
      || document.querySelector('[data-qa="profile-image"] img');
    if (photoEl) data.profilePhoto = photoEl.src || null;

    // Wechselbereitschaft (Xing shows this explicitly)
    const wechselEl = document.querySelector('[data-qa="profile-career-level"]');
    if (wechselEl) {
      const text = wechselEl.textContent.trim();
      if (/offen|wechselbereit/i.test(text)) {
        data.availability = text;
      }
    }
    
    // Xing "Ich suche" section
    const seekingEl = document.querySelector('[data-qa="profile-seeking"]');
    if (seekingEl) {
      data.availability = (data.availability || '') + ' ' + seekingEl.textContent.trim();
      data.availability = data.availability.trim();
    }

    data.xingUrl = location.href.split('?')[0];
    data.sourceChannel = 'Xing';
    data.berufsexamen = detectBerufsexamen(document.body.innerText);

    return { success: true, data, platform: 'xing' };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Detect Berufsexamen (StB/WP/RA) from page text.
 * Critical for the MatchMaker market (tax/audit/legal).
 */
function detectBerufsexamen(text) {
  const exams = [];
  if (/steuerberater|stb[\s\.\,]|dipl\.?\s*finanzwirt/i.test(text)) exams.push('StB');
  if (/wirtschaftsprüfer|wp[\s\.\,]/i.test(text)) exams.push('WP');
  if (/rechtsanwalt|rechtsanwältin|\bra[\s\.\,]/i.test(text)) exams.push('RA');
  if (/fachanwalt/i.test(text)) exams.push('Fachanwalt');
  if (/notar/i.test(text)) exams.push('Notar');
  return exams.length > 0 ? exams.join(', ') : null;
}

// ═══════════════════════════════════════════════════════════════════════
// OUTREACH AUTOMATION (existing BOOT functionality)
// ═══════════════════════════════════════════════════════════════════════

async function sendContactRequest({ linkedin_url, text_content, job_id, api_base, token }) {
  try {
    if (!location.href.includes(linkedin_url.replace('https://linkedin.com', '').replace('https://www.linkedin.com', ''))) {
      window.location.href = linkedin_url;
      await waitForPageLoad(10000);
    }

    const connectBtn = await findConnectButton(15000);
    if (!connectBtn) throw new Error('Verbinden-Button nicht gefunden');
    connectBtn.click();
    await sleep(2000);

    if (text_content) {
      const addNoteBtn = findElement([
        'button[aria-label="Nachricht hinzufügen"]',
        'button[aria-label="Jetzt eine Notiz hinzufügen"]',
        'button[aria-label="Add a note"]',
      ]);
      if (addNoteBtn) {
        addNoteBtn.click();
        await sleep(1000);
      }

      const textarea = findElement([
        'textarea#custom-message',
        'textarea.connect-button-send-invite__custom-message',
        'textarea[name="message"]',
      ]);
      if (textarea) {
        textarea.focus();
        textarea.value = '';
        for (const char of text_content) {
          textarea.value += char;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await sleep(300);
      }
    }

    await sleep(500);

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
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ status, error }),
    });
  } catch (e) { console.error('[BOOT] Reporting failed:', e.message); }
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

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
  ];

  const start = Date.now();
  while (Date.now() - start < timeout) {
    const moreBtn = document.querySelector('button[aria-label="Mehr"]') ||
                    document.querySelector('button[aria-label="More"]');
    if (moreBtn) { moreBtn.click(); await sleep(500); }

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }

    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === 'verbinden' || text === 'connect') return btn;
    }

    await sleep(1000);
  }
  return null;
}

function waitForPageLoad(timeout) {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      if (document.readyState === 'complete' || Date.now() - start > timeout) resolve();
      else setTimeout(check, 500);
    };
    setTimeout(check, 2000);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
