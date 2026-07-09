// content.js — MatchMaker BOOT Extension v3.0
// Runs on LinkedIn & Xing pages
// Supports: 1) Profile scraping/import to CRM  2) Outreach automation

(function() {
  'use strict';

  // Message handler
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
    return { success: false, error: 'Nicht auf LinkedIn oder Xing. Bitte ein Profil öffnen.' };
  }

  // ── LinkedIn Scraper ─────────────────────────────────────────────────

  function scrapeLinkedInProfile() {
    try {
      // Check we're on a profile page
      if (!location.pathname.startsWith('/in/')) {
        return { success: false, error: 'Kein LinkedIn-Profil. Bitte ein /in/xxx Profil öffnen.' };
      }

      const data = {};

      // ── Full name ──
      const nameEl = queryFirst([
        'h1.text-heading-xlarge',
        'h1.inline.t-24',
        '.pv-top-card--list h1',
        '[data-anonymize="person-name"]',
        '.pv-text-details__left-panel h1',
        'main section:first-child h1'
      ]);
      if (nameEl) {
        const fullName = nameEl.textContent.trim();
        const parsed = parseName(fullName);
        data.academicTitle = parsed.title;
        data.firstName = parsed.firstName;
        data.lastName = parsed.lastName;
      }

      // ── Headline / Position ──
      const headlineEl = queryFirst([
        '.text-body-medium.break-words',
        '.pv-top-card--list .text-body-medium',
        '.pv-text-details__left-panel .text-body-medium',
        '[data-anonymize="headline"]'
      ]);
      if (headlineEl) {
        data.currentPosition = headlineEl.textContent.trim();
      }

      // ── Company ──
      // Try the "current company" link in the top card
      const companyLink = queryFirst([
        '.pv-text-details__right-panel-item-text',
        'button[aria-label*="Aktuelle Firma"]',
        'button[aria-label*="Current company"]',
        '[data-anonymize="company-name"]'
      ]);
      if (companyLink) {
        data.currentCompany = companyLink.textContent.trim();
      }

      // Fallback: First item in experience section
      if (!data.currentCompany) {
        const expItems = document.querySelectorAll('#experience ~ div .pvs-entity--with-path, #experience + div + div li');
        if (expItems.length > 0) {
          const compSpan = expItems[0].querySelector('.t-bold span, .hoverable-link-text span');
          if (compSpan) data.currentCompany = compSpan.textContent.trim();
        }
      }

      // ── Location ──
      const locationEl = queryFirst([
        '.text-body-small.inline.t-black--light.break-words',
        '.pv-top-card--list-bullet .text-body-small',
        '.pv-text-details__left-panel .text-body-small.inline',
        'span.t-black--light.break-words'
      ]);
      if (locationEl) {
        const loc = locationEl.textContent.trim();
        // "Köln, Nordrhein-Westfalen, Deutschland" → "Köln"
        data.companyCity = loc.split(',')[0]?.trim() || loc;
        data.locationFull = loc;
      }

      // ── Profile photo ──
      const photoEl = queryFirst([
        '.pv-top-card-profile-picture__image--show',
        '.profile-photo-edit__preview',
        'img.pv-top-card-profile-picture__image'
      ]);
      if (photoEl && photoEl.src && !photoEl.src.includes('ghost')) {
        data.profilePhoto = photoEl.src;
      }

      // ── Profile URL ──
      data.linkedInUrl = location.href.split('?')[0].replace(/\/$/, '');

      // ── Open to Work ──
      const otw = queryFirst([
        '.pv-top-card--open-to-work',
        '[class*="open-to-work"]',
        '.pv-open-to-carousel'
      ]);
      if (otw) {
        data.availability = 'Offen für Angebote';
      }

      // ── Contact Info (if visible) ──
      // LinkedIn shows this in a modal — check if already open or inline
      const contactSection = document.querySelector('.pv-contact-info');
      if (contactSection) {
        const emailEl = contactSection.querySelector('a[href^="mailto:"]');
        if (emailEl) data.email = emailEl.textContent.trim();
        const phoneEl = contactSection.querySelector('.t-14.t-black.t-normal');
        if (phoneEl) data.phone = phoneEl.textContent.trim();
      }
      // Also check sidebar contact info (sometimes visible)
      const sideEmails = document.querySelectorAll('section.ci-email a[href^="mailto:"]');
      if (sideEmails.length > 0 && !data.email) {
        data.email = sideEmails[0].textContent.trim();
      }

      // ── Berufsexamen ──
      data.berufsexamen = detectBerufsexamen(document.body.innerText);

      // ── About section — Wechselbereitschaft signals ──
      const aboutEl = queryFirst([
        '#about ~ .pvs-list__outer-container .inline-show-more-text',
        '#about ~ div .inline-show-more-text',
        '.pv-about-section .inline-show-more-text'
      ]);
      if (aboutEl) {
        const aboutText = aboutEl.textContent.trim();
        if (/wechselbereit|offen für|neue herausforderung|suche.*position|looking for/i.test(aboutText)) {
          data.availability = data.availability || 'Wechselbereitschaft signalisiert';
        }
      }

      // ── Education (for Berufsexamen detection) ──
      const eduSection = document.querySelector('#education');
      if (eduSection) {
        const eduText = eduSection.parentElement?.innerText || '';
        const eduExamen = detectBerufsexamen(eduText);
        if (eduExamen && !data.berufsexamen) {
          data.berufsexamen = eduExamen;
        }
      }

      data.sourceChannel = 'LinkedIn';
      return { success: true, data, platform: 'linkedin' };

    } catch (err) {
      return { success: false, error: 'LinkedIn-Scraping Fehler: ' + err.message };
    }
  }

  // ── Xing Scraper ─────────────────────────────────────────────────────

  function scrapeXingProfile() {
    try {
      const data = {};

      // ── Name ──
      const nameEl = queryFirst([
        '[data-qa="profile-name"]',
        'h1[data-xds]',
        '.EntityInfo-entity-name',
        '.profile-info h1',
        'h1.headstone-name'
      ]);
      if (nameEl) {
        const parsed = parseName(nameEl.textContent.trim());
        data.academicTitle = parsed.title;
        data.firstName = parsed.firstName;
        data.lastName = parsed.lastName;
      }

      // ── Position ──
      const posEl = queryFirst([
        '[data-qa="profile-occupation"]',
        '.EntityInfo-entity-occupation',
        '.headstone-occupation',
        '[data-xds="Bodytext"]'
      ]);
      if (posEl) data.currentPosition = posEl.textContent.trim();

      // ── Company ──
      const compEl = queryFirst([
        '[data-qa="profile-company"]',
        '.EntityInfo-entity-company',
        'a[data-qa="profile-company-link"]'
      ]);
      if (compEl) data.currentCompany = compEl.textContent.trim();

      // ── Location ──
      const locEl = queryFirst([
        '[data-qa="profile-location"]',
        '.EntityInfo-entity-location',
        '[data-qa="profile-city"]'
      ]);
      if (locEl) data.companyCity = locEl.textContent.trim();

      // ── Profile photo ──
      const photoEl = queryFirst([
        '.EntityInfo-entity-image img',
        '[data-qa="profile-image"] img',
        'img.headstone-image'
      ]);
      if (photoEl && photoEl.src) data.profilePhoto = photoEl.src;

      // ── Wechselbereitschaft ──
      const wechselEl = queryFirst([
        '[data-qa="profile-career-level"]',
        '[data-qa="profile-status"]'
      ]);
      if (wechselEl) {
        const text = wechselEl.textContent.trim();
        if (/offen|wechselbereit|auf der suche/i.test(text)) {
          data.availability = text;
        }
      }

      // "Ich suche" section
      const seekingEl = document.querySelector('[data-qa="profile-seeking"]');
      if (seekingEl) {
        data.availability = ((data.availability || '') + ' ' + seekingEl.textContent.trim()).trim();
      }

      // ── Contact info ──
      const emailEl = queryFirst([
        '[data-qa="profile-email"] a',
        'a[href^="mailto:"]'
      ]);
      if (emailEl) data.email = emailEl.textContent.trim() || emailEl.href.replace('mailto:', '');

      const phoneEl = queryFirst([
        '[data-qa="profile-phone"]',
        '[data-qa="profile-mobile"]'
      ]);
      if (phoneEl) data.phone = phoneEl.textContent.trim();

      data.xingUrl = location.href.split('?')[0].replace(/\/$/, '');
      data.sourceChannel = 'Xing';
      data.berufsexamen = detectBerufsexamen(document.body.innerText);

      return { success: true, data, platform: 'xing' };

    } catch (err) {
      return { success: false, error: 'Xing-Scraping Fehler: ' + err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BERUFSEXAMEN DETECTION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Detect Berufsexamen (StB/WP/RA) from page text.
   * Critical for MatchMaker's market (tax/audit/legal recruitment).
   */
  function detectBerufsexamen(text) {
    const exams = [];
    // Steuerberater
    if (/steuerberater(?:in)?|(?:^|\s|\()stb(?:\.|\s|\)|,|$)|dipl[\.\-]?\s*finanzwirt/im.test(text)) {
      exams.push('StB');
    }
    // Wirtschaftsprüfer
    if (/wirtschaftspr[üu]fer(?:in)?|(?:^|\s|\()wp(?:\.|\s|\)|,|$)/im.test(text)) {
      exams.push('WP');
    }
    // Rechtsanwalt
    if (/rechtsanw[äa]lt(?:in)?|(?:^|\s|\()ra(?:\.|\s|\)|,|$)/im.test(text)) {
      exams.push('RA');
    }
    // Fachanwalt
    if (/fachanw[äa]lt/i.test(text)) {
      exams.push('Fachanwalt');
    }
    // Notar
    if (/\bnotar(?:in)?\b/i.test(text)) {
      exams.push('Notar');
    }
    // CPA (international)
    if (/\bcpa\b/i.test(text)) {
      exams.push('CPA');
    }
    return exams.length > 0 ? exams.join(', ') : null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NAME PARSER
  // ═══════════════════════════════════════════════════════════════════════

  function parseName(fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    const titlePrefixes = ['Dr.', 'Prof.', 'Dipl.', 'Dipl.-', 'RA', 'StB', 'WP', 'MBA', 'LL.M.', 'LL.M', 'M.Sc.'];
    const titleParts = [];
    const nameParts = [];

    for (const p of parts) {
      // Check if it's a known title/prefix
      if (titlePrefixes.some(t => p.toLowerCase().startsWith(t.toLowerCase()) || p === t)) {
        titleParts.push(p);
      } else {
        nameParts.push(p);
      }
    }

    return {
      title: titleParts.length > 0 ? titleParts.join(' ') : null,
      firstName: nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : (nameParts[0] || ''),
      lastName: nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // OUTREACH AUTOMATION (existing BOOT functionality)
  // ═══════════════════════════════════════════════════════════════════════

  async function sendContactRequest({ linkedin_url, text_content, job_id, api_base, token }) {
    try {
      // Navigate to profile if not already there
      const targetPath = linkedin_url.replace('https://linkedin.com', '').replace('https://www.linkedin.com', '');
      if (!location.href.includes(targetPath)) {
        window.location.href = linkedin_url;
        await waitForPageLoad(10000);
      }

      const connectBtn = await findConnectButton(15000);
      if (!connectBtn) throw new Error('Verbinden-Button nicht gefunden');
      connectBtn.click();
      await sleep(2000);

      // Add note if text provided
      if (text_content) {
        const addNoteBtn = queryFirst([
          'button[aria-label="Nachricht hinzufügen"]',
          'button[aria-label="Jetzt eine Notiz hinzufügen"]',
          'button[aria-label="Add a note"]',
        ]);
        if (addNoteBtn) {
          addNoteBtn.click();
          await sleep(1000);
        }

        const textarea = queryFirst([
          'textarea#custom-message',
          'textarea.connect-button-send-invite__custom-message',
          'textarea[name="message"]',
        ]);
        if (textarea) {
          textarea.focus();
          textarea.value = '';
          // Type character by character (simulates human input)
          for (const char of text_content) {
            textarea.value += char;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await sleep(300);
        }
      }

      await sleep(500);

      // Click send
      const sendBtn = queryFirst([
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
      await fetch(`${api_base}/api/outreach-ext/jobs/${job_id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ status, error }),
      });
    } catch (e) { console.error('[BOOT] Reporting failed:', e.message); }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  function queryFirst(selectors) {
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
      // Try "More" dropdown first
      const moreBtn = queryFirst([
        'button[aria-label="Mehr"]',
        'button[aria-label="More"]',
        'button[aria-label="More actions"]'
      ]);
      if (moreBtn) { moreBtn.click(); await sleep(500); }

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
      }

      // Text-based fallback
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

})();
