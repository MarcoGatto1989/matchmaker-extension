// content.js — MatchMaker BOOT Extension v3.6
// Runs on LinkedIn & XING pages
// Supports profile scraping, platform-project assignment, outreach and social publishing.

(function() {
  'use strict';

  // Message handler
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCRAPE_SEARCH_RESULTS') {
      try {
        const candidates = msg.source === 'xing' ? scrapeXingSearchResults() : scrapeLinkedInSearchResults();
        sendResponse({ success: true, candidates });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }
    if (msg.type === 'ADD_TO_PLATFORM_PROJECT') {
      addToPlatformProject(msg.payload)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (msg.type === 'EXECUTE_CONTACT_REQUEST') {
      sendContactRequest(msg.payload)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (msg.type === 'EXECUTE_SOCIAL_POST') {
      publishSocialPost(msg.payload)
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

  function scrapeLinkedInProfile() {
    try {
      if (!location.pathname.startsWith('/in/')) {
        return { success: false, error: 'Kein LinkedIn-Profil. Bitte ein /in/xxx Profil öffnen.' };
      }

      const data = {};
      const nameEl = queryFirst([
        'h1.text-heading-xlarge',
        'h1.inline.t-24',
        '.pv-top-card--list h1',
        '[data-anonymize="person-name"]',
        '.pv-text-details__left-panel h1',
        'main section:first-child h1'
      ]);
      if (nameEl) {
        const parsed = parseName(nameEl.textContent.trim());
        data.academicTitle = parsed.title;
        data.firstName = parsed.firstName;
        data.lastName = parsed.lastName;
      }

      const headlineEl = queryFirst([
        '.text-body-medium.break-words',
        '.pv-top-card--list .text-body-medium',
        '.pv-text-details__left-panel .text-body-medium',
        '[data-anonymize="headline"]'
      ]);
      if (headlineEl) data.currentPosition = headlineEl.textContent.trim();

      const companyLink = queryFirst([
        '.pv-text-details__right-panel-item-text',
        'button[aria-label*="Aktuelle Firma"]',
        'button[aria-label*="Current company"]',
        '[data-anonymize="company-name"]'
      ]);
      if (companyLink) data.currentCompany = companyLink.textContent.trim();

      if (!data.currentCompany) {
        const expItems = document.querySelectorAll('#experience ~ div .pvs-entity--with-path, #experience + div + div li');
        if (expItems.length > 0) {
          const compSpan = expItems[0].querySelector('.t-bold span, .hoverable-link-text span');
          if (compSpan) data.currentCompany = compSpan.textContent.trim();
        }
      }

      const locationEl = queryFirst([
        '.text-body-small.inline.t-black--light.break-words',
        '.pv-top-card--list-bullet .text-body-small',
        '.pv-text-details__left-panel .text-body-small.inline',
        'span.t-black--light.break-words'
      ]);
      if (locationEl) {
        const loc = locationEl.textContent.trim();
        data.companyCity = loc.split(',')[0]?.trim() || loc;
        data.locationFull = loc;
      }

      const photoEl = queryFirst([
        '.pv-top-card-profile-picture__image--show',
        '.profile-photo-edit__preview',
        'img.pv-top-card-profile-picture__image'
      ]);
      if (photoEl && photoEl.src && !photoEl.src.includes('ghost')) data.profilePhoto = photoEl.src;

      data.linkedInUrl = location.href.split('?')[0].replace(/\/$/, '');

      const otw = queryFirst([
        '.pv-top-card--open-to-work',
        '[class*="open-to-work"]',
        '.pv-open-to-carousel'
      ]);
      if (otw) data.availability = 'Offen für Angebote';

      const contactSection = document.querySelector('.pv-contact-info');
      if (contactSection) {
        const emailEl = contactSection.querySelector('a[href^="mailto:"]');
        if (emailEl) data.email = emailEl.textContent.trim();
        const phoneEl = contactSection.querySelector('.t-14.t-black.t-normal');
        if (phoneEl) data.phone = phoneEl.textContent.trim();
      }
      const sideEmails = document.querySelectorAll('section.ci-email a[href^="mailto:"]');
      if (sideEmails.length > 0 && !data.email) data.email = sideEmails[0].textContent.trim();

      data.berufsexamen = detectBerufsexamen(document.body.innerText);

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

      const eduSection = document.querySelector('#education');
      if (eduSection) {
        const eduText = eduSection.parentElement?.innerText || '';
        const eduExamen = detectBerufsexamen(eduText);
        if (eduExamen && !data.berufsexamen) data.berufsexamen = eduExamen;
      }

      data.sourceChannel = 'LinkedIn';
      return { success: true, data, platform: 'linkedin' };
    } catch (err) {
      return { success: false, error: 'LinkedIn-Scraping Fehler: ' + err.message };
    }
  }

  function scrapeXingProfile() {
    try {
      const data = {};
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

      const posEl = queryFirst([
        '[data-qa="profile-occupation"]',
        '.EntityInfo-entity-occupation',
        '.headstone-occupation',
        '[data-xds="Bodytext"]'
      ]);
      if (posEl) data.currentPosition = posEl.textContent.trim();

      const compEl = queryFirst([
        '[data-qa="profile-company"]',
        '.EntityInfo-entity-company',
        'a[data-qa="profile-company-link"]'
      ]);
      if (compEl) data.currentCompany = compEl.textContent.trim();

      const locEl = queryFirst([
        '[data-qa="profile-location"]',
        '.EntityInfo-entity-location',
        '[data-qa="profile-city"]'
      ]);
      if (locEl) data.companyCity = locEl.textContent.trim();

      const photoEl = queryFirst([
        '.EntityInfo-entity-image img',
        '[data-qa="profile-image"] img',
        'img.headstone-image'
      ]);
      if (photoEl && photoEl.src) data.profilePhoto = photoEl.src;

      const wechselEl = queryFirst([
        '[data-qa="profile-career-level"]',
        '[data-qa="profile-status"]'
      ]);
      if (wechselEl) {
        const text = wechselEl.textContent.trim();
        if (/offen|wechselbereit|auf der suche/i.test(text)) data.availability = text;
      }

      const seekingEl = document.querySelector('[data-qa="profile-seeking"]');
      if (seekingEl) data.availability = ((data.availability || '') + ' ' + seekingEl.textContent.trim()).trim();

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

  function detectBerufsexamen(text) {
    const exams = [];
    if (/steuerberater(?:in)?|(?:^|\s|\()stb(?:\.|\s|\)|,|$)|dipl[\.\-]?\s*finanzwirt/im.test(text)) exams.push('StB');
    if (/wirtschaftspr[üu]fer(?:in)?|(?:^|\s|\()wp(?:\.|\s|\)|,|$)/im.test(text)) exams.push('WP');
    if (/rechtsanw[äa]lt(?:in)?|(?:^|\s|\()ra(?:\.|\s|\)|,|$)/im.test(text)) exams.push('RA');
    if (/fachanw[äa]lt/i.test(text)) exams.push('Fachanwalt');
    if (/\bnotar(?:in)?\b/i.test(text)) exams.push('Notar');
    if (/\bcpa\b/i.test(text)) exams.push('CPA');
    return exams.length > 0 ? exams.join(', ') : null;
  }

  function parseName(fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    const titlePrefixes = ['Dr.', 'Prof.', 'Dipl.', 'Dipl.-', 'RA', 'StB', 'WP', 'MBA', 'LL.M.', 'LL.M', 'M.Sc.'];
    const titleParts = [];
    const nameParts = [];
    for (const p of parts) {
      if (titlePrefixes.some(t => p.toLowerCase().startsWith(t.toLowerCase()) || p === t)) titleParts.push(p);
      else nameParts.push(p);
    }
    return {
      title: titleParts.length > 0 ? titleParts.join(' ') : null,
      firstName: nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : (nameParts[0] || ''),
      lastName: nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NETWORK PROJECT ASSIGNMENT — LinkedIn Recruiter & XING TalentManager
  // ═══════════════════════════════════════════════════════════════════════

  async function addToPlatformProject({ network, project_name, project_url }) {
    const platform = detectPlatform();
    const requestedNetwork = String(network || '').toLowerCase();
    const projectName = String(project_name || '').trim();
    const projectUrl = String(project_url || '').trim();

    if (!projectName) return { success: false, error: 'Projektname fehlt.' };
    if (requestedNetwork !== platform) {
      return { success: false, error: `Die geöffnete Seite gehört zu ${platform}, der Auftrag aber zu ${requestedNetwork}.` };
    }
    if (/login|signin|auth/i.test(location.pathname)) {
      return { success: false, error: 'Bitte zuerst bei der Plattform anmelden und den Auftrag erneut starten.' };
    }
    if (requestedNetwork === 'linkedin') return addLinkedInToRecruiterProject(projectName, projectUrl);
    if (requestedNetwork === 'xing') return addXingToTalentManagerProject(projectName, projectUrl);
    return { success: false, error: 'Nicht unterstütztes Netzwerk.' };
  }

  async function addLinkedInToRecruiterProject(projectName, projectUrl) {
    try {
      // Recruiter exposes this action as "Save to project" on candidate profiles.
      const saveToProject = await findVisibleBySelectorsOrText([
        'button[aria-label*="Save to project" i]',
        'button[aria-label*="Projekt" i]',
        '[data-test*="save-to-project" i]',
        '[data-control-name*="save_to_project" i]'
      ], /save to project|in projekt speichern|zu projekt speichern|projekt speichern/i, 15000, 'button, [role="button"], a');

      if (!saveToProject) {
        const recruiterHint = findVisibleElement('a[href*="/talent/"], a[href*="/recruiter/"], button');
        const hintText = normalizeUiText(recruiterHint?.textContent || '');
        if (/recruiter/.test(hintText)) {
          throw new Error('Das Profil ist geöffnet, aber „Save to project“ ist hier nicht verfügbar. Bitte das Kandidatenprofil in LinkedIn Recruiter öffnen.');
        }
        throw new Error('LinkedIn Recruiter: „Save to project“ wurde auf diesem Kandidatenprofil nicht gefunden.');
      }
      saveToProject.click();
      await sleep(1000);

      const existingChoice = await findVisibleBySelectorsOrText([], /choose existing project|bestehendes projekt|vorhandenes projekt/i, 3000, 'button, [role="button"], label');
      if (existingChoice) {
        existingChoice.click();
        await sleep(700);
      }

      const scope = await waitForProjectScope(10000);
      if (!scope) throw new Error('LinkedIn Recruiter: Projektauswahl wurde nicht geöffnet.');

      const searchInput = findVisibleWithin(scope, [
        'input[placeholder*="project" i]',
        'input[placeholder*="Projekt" i]',
        'input[aria-label*="project" i]',
        'input[aria-label*="Projekt" i]',
        'input[type="search"]',
        'input[type="text"]'
      ]);
      if (searchInput) {
        setNativeInputValue(searchInput, projectName);
        await sleep(900);
      }

      const option = await findProjectOption(scope, projectName, projectUrl, 8000);
      if (!option) throw new Error(`LinkedIn Recruiter: Projekt „${projectName}“ wurde nicht eindeutig gefunden.`);
      if (!isSelectedProjectOption(option)) {
        clickableProjectElement(option).click();
        await sleep(600);
      }

      const confirm = await findVisibleBySelectorsOrText([
        '[role="dialog"] button[type="submit"]',
        '[role="dialog"] button.artdeco-button--primary',
        'button[data-test*="save" i]'
      ], /^save$|^speichern$|^sichern$|^fertig$|^done$/i, 7000, 'button, [role="button"]', scope);
      if (!confirm || confirm.disabled || confirm.getAttribute('aria-disabled') === 'true') {
        throw new Error('LinkedIn Recruiter: Bestätigungsbutton zum Speichern wurde nicht gefunden.');
      }
      confirm.click();
      await sleep(1200);
      return { success: true, projectName };
    } catch (error) {
      return { success: false, error: error.message || 'LinkedIn-Recruiter-Zuordnung fehlgeschlagen.' };
    }
  }

  async function addXingToTalentManagerProject(projectName, projectUrl) {
    try {
      const more = await findVisibleBySelectorsOrText([
        'button[aria-label*="Mehr" i]',
        'button[aria-label*="More" i]',
        'button[aria-label*="Aktion" i]',
        'button[data-qa*="more" i]',
        '[data-qa*="actions"] button'
      ], /^mehr$|^more$|aktionen|weitere aktionen/i, 12000, 'button, [role="button"]');
      if (more) {
        more.click();
        await sleep(600);
      }

      const addAction = await findVisibleBySelectorsOrText([
        '[data-qa*="add-to-project" i]',
        'button[aria-label*="Projekt" i]'
      ], /zu projekt hinzufügen|in projekt hinzufügen|add to project/i, 7000, 'button, [role="button"], a, li');
      if (!addAction) throw new Error('XING TalentManager: „Zu Projekt hinzufügen“ wurde nicht gefunden.');
      addAction.click();
      await sleep(900);

      const scope = await waitForProjectScope(10000);
      if (!scope) throw new Error('XING TalentManager: Projektauswahl wurde nicht geöffnet.');

      const searchInput = findVisibleWithin(scope, [
        'input[placeholder*="Projekt" i]',
        'input[placeholder*="project" i]',
        'input[aria-label*="Projekt" i]',
        'input[aria-label*="project" i]',
        'input[type="search"]',
        'input[type="text"]'
      ]);
      if (searchInput) {
        setNativeInputValue(searchInput, projectName);
        await sleep(900);
      }

      const option = await findProjectOption(scope, projectName, projectUrl, 8000);
      if (!option) throw new Error(`XING TalentManager: Projekt „${projectName}“ wurde nicht eindeutig gefunden.`);
      if (!isSelectedProjectOption(option)) {
        clickableProjectElement(option).click();
        await sleep(600);
      }

      const confirm = await findVisibleBySelectorsOrText([
        '[role="dialog"] button[type="submit"]',
        'button[data-qa*="add-to-project" i]',
        'button[data-qa*="confirm" i]'
      ], /^(zu projekt hinzufügen|in projekt hinzufügen|add to project|hinzufügen|add)$/i, 7000, 'button, [role="button"]', scope);
      if (!confirm || confirm.disabled || confirm.getAttribute('aria-disabled') === 'true') {
        throw new Error('XING TalentManager: Bestätigungsbutton zum Hinzufügen wurde nicht gefunden.');
      }
      confirm.click();
      await sleep(1200);
      return { success: true, projectName };
    } catch (error) {
      return { success: false, error: error.message || 'XING-TalentManager-Zuordnung fehlgeschlagen.' };
    }
  }

  async function waitForProjectScope(timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const candidates = Array.from(document.querySelectorAll('[role="dialog"], [role="listbox"], [data-test-modal], [data-qa*="modal"], [data-qa*="dialog"], .artdeco-modal'));
      const visible = candidates.find(isVisible);
      if (visible) return visible;
      await sleep(250);
    }
    return null;
  }

  async function findProjectOption(scope, projectName, projectUrl, timeout) {
    const normalizedName = normalizeUiText(projectName);
    const urlHints = projectUrlHints(projectUrl);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const candidates = Array.from(scope.querySelectorAll('label, li, [role="option"], [role="menuitem"], [role="checkbox"], button, a, div'))
        .filter(isVisible)
        .filter(element => {
          const text = normalizeUiText(element.textContent || '');
          return text === normalizedName || text.startsWith(normalizedName + ' ') || text.endsWith(' ' + normalizedName);
        });

      if (candidates.length) {
        if (urlHints.length) {
          const byUrl = candidates.find(element => {
            const link = element.matches('a[href]') ? element : element.querySelector('a[href]');
            const href = String(link?.href || element.getAttribute('href') || '');
            return urlHints.some(hint => hint && href.includes(hint));
          });
          if (byUrl) return byUrl;
        }
        const mostSpecific = candidates.sort((a, b) => a.children.length - b.children.length)[0];
        if (candidates.filter(el => normalizeUiText(el.textContent || '') === normalizedName).length <= 1) return mostSpecific;
      }
      await sleep(250);
    }
    return null;
  }

  function projectUrlHints(rawUrl) {
    if (!rawUrl) return [];
    try {
      const url = new URL(rawUrl);
      return url.pathname.split('/').filter(part => part.length >= 4).slice(-3);
    } catch {
      return [];
    }
  }

  function isSelectedProjectOption(element) {
    const checkbox = element.matches('input[type="checkbox"], input[type="radio"]')
      ? element
      : element.querySelector('input[type="checkbox"], input[type="radio"]');
    if (checkbox?.checked) return true;
    const checkedElement = element.closest('[aria-checked="true"], [aria-selected="true"]') || element.querySelector('[aria-checked="true"], [aria-selected="true"]');
    return Boolean(checkedElement);
  }

  function clickableProjectElement(element) {
    if (element.matches('button, a, label, [role="option"], [role="menuitem"], [role="checkbox"]')) return element;
    return element.closest('button, a, label, [role="option"], [role="menuitem"], [role="checkbox"]')
      || element.querySelector('button, a, label, [role="option"], [role="menuitem"], [role="checkbox"]')
      || element;
  }

  function normalizeUiText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function findVisibleElement(selector) {
    return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
  }

  function findVisibleWithin(scope, selectors) {
    for (const selector of selectors) {
      const found = Array.from(scope.querySelectorAll(selector)).find(isVisible);
      if (found) return found;
    }
    return null;
  }

  function setNativeInputValue(input, value) {
    input.focus();
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function findVisibleBySelectorsOrText(selectors, textPattern, timeout, candidateSelector = 'button, [role="button"]', scope = document) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      for (const selector of selectors) {
        const direct = Array.from(scope.querySelectorAll(selector)).find(isVisible);
        if (direct) return direct;
      }
      const byText = Array.from(scope.querySelectorAll(candidateSelector)).find(element => isVisible(element) && textPattern.test((element.textContent || '').replace(/\s+/g, ' ').trim()));
      if (byText) return byText;
      await sleep(250);
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // OUTREACH AUTOMATION
  // ═══════════════════════════════════════════════════════════════════════

  async function sendContactRequest({ linkedin_url, text_content, job_id, api_base, token }) {
    try {
      const targetPath = linkedin_url.replace('https://linkedin.com', '').replace('https://www.linkedin.com', '');
      if (!location.href.includes(targetPath)) {
        window.location.href = linkedin_url;
        await waitForPageLoad(10000);
      }

      const connectBtn = await findConnectButton(15000);
      if (!connectBtn) throw new Error('Verbinden-Button nicht gefunden');
      connectBtn.click();
      await sleep(2000);

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
          for (const char of text_content) {
            textarea.value += char;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await sleep(300);
        }
      }

      await sleep(500);
      const sendBtn = queryFirst([
        'button[aria-label="Einladung senden"]',
        'button[aria-label="Send invitation"]',
        'button[aria-label="Verbinden"]',
        'button[aria-label="Send now"]',
        '.artdeco-modal .artdeco-button--primary',
      ]);
      if (sendBtn) sendBtn.click();
      else throw new Error('Senden-Button nicht gefunden');

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
  // SOCIAL PUBLISHING
  // ═══════════════════════════════════════════════════════════════════════

  async function publishSocialPost({ channel, text, image }) {
    if (!text || !text.trim()) return { success: false, error: 'Der Beitrag enthält keinen Text.' };
    if (/login|signin|auth/i.test(location.pathname)) {
      return { success: false, error: 'Bitte zuerst beim Anbieter anmelden und den Auftrag erneut starten.' };
    }
    if (channel === 'linkedin') return publishLinkedInPost(text.trim(), image);
    if (channel === 'xing_social') return publishXingPost(text.trim(), image);
    return { success: false, error: `Der Kanal ${channel} unterstützt noch keinen Social-Post über die Browser-Verbindung.` };
  }

  async function publishLinkedInPost(text, image) {
    const start = await findBySelectorsOrText([
      'button.share-box-feed-entry__trigger',
      'button[aria-label*="Beitrag erstellen"]',
      'button[aria-label*="Start a post"]',
    ], /beitrag erstellen|start a post/i, 15000);
    if (!start) throw new Error('LinkedIn-Beitragsdialog wurde nicht gefunden. Ist das Konto angemeldet?');
    start.click();
    await sleep(1800);

    const editor = await waitForElement([
      '.share-creation-state__text-editor [contenteditable="true"]',
      '.ql-editor[contenteditable="true"]',
      '[role="dialog"] [contenteditable="true"]',
    ], 15000);
    if (!editor) throw new Error('LinkedIn-Textfeld wurde nicht gefunden.');
    setEditableText(editor, text);
    await sleep(600);

    if (image) await attachImageToComposer(image, 'linkedin');

    const submit = await findBySelectorsOrText([
      'button.share-actions__primary-action',
      '[role="dialog"] button[aria-label="Posten"]',
      '[role="dialog"] button[aria-label="Post"]',
    ], /^posten$|^post$/i, 10000, true);
    if (!submit || submit.disabled) throw new Error('LinkedIn-Button „Posten“ ist nicht verfügbar.');
    submit.click();
    await sleep(1800);
    return { success: true };
  }

  async function publishXingPost(text, image) {
    const start = await findBySelectorsOrText([
      '[data-qa*="create-post"]',
      'button[aria-label*="Beitrag erstellen"]',
      'button[aria-label*="Create post"]',
    ], /beitrag erstellen|beitrag verfassen|create post/i, 15000);
    if (!start) throw new Error('XING-Beitragsdialog wurde nicht gefunden. Ist das Konto angemeldet und Social Posting verfügbar?');
    start.click();
    await sleep(1500);

    const editor = await waitForElement([
      '[data-qa*="post"] [contenteditable="true"]',
      '[role="dialog"] [contenteditable="true"]',
      '[role="dialog"] textarea',
    ], 12000);
    if (!editor) throw new Error('XING-Textfeld wurde nicht gefunden.');
    setEditableText(editor, text);
    await sleep(500);

    if (image) await attachImageToComposer(image, 'xing_social');

    const submit = await findBySelectorsOrText([
      '[data-qa*="submit-post"]',
      '[role="dialog"] button[type="submit"]',
    ], /^veröffentlichen$|^posten$|^publish$/i, 10000, true);
    if (!submit || submit.disabled) throw new Error('XING-Button „Veröffentlichen“ ist nicht verfügbar.');
    submit.click();
    await sleep(1500);
    return { success: true };
  }

  async function attachImageToComposer(image, channel) {
    if (!image?.base64 || !image?.mimeType) throw new Error('Das Beitragsbild ist unvollständig.');
    let input = await waitForElement([
      '[role="dialog"] input[type="file"][accept*="image"]',
      'input[type="file"][accept*="image"]',
      '[role="dialog"] input[type="file"]',
    ], 2500);
    if (!input) {
      const mediaButton = await findBySelectorsOrText([
        '[role="dialog"] button[aria-label*="Medien"]',
        '[role="dialog"] button[aria-label*="Media"]',
        '[role="dialog"] button[aria-label*="Foto"]',
        '[role="dialog"] button[aria-label*="Photo"]',
        '[role="dialog"] button[data-control-name*="image"]',
        '[role="dialog"] button[data-qa*="image"]',
      ], /medien|media|foto|photo|bild|image/i, 5000, true);
      if (mediaButton) mediaButton.click();
      input = await waitForElement([
        '[role="dialog"] input[type="file"][accept*="image"]',
        'input[type="file"][accept*="image"]',
        '[role="dialog"] input[type="file"]',
      ], 7000);
    }
    if (!input) throw new Error(`${channel === 'linkedin' ? 'LinkedIn' : 'XING'}-Bildupload wurde nicht gefunden. Der Beitrag wurde nicht ohne Bild veröffentlicht.`);
    const binary = atob(image.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const file = new File([bytes], image.fileName || 'esos-social.webp', { type: image.mimeType });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(3500);
  }

  function setEditableText(element, text) {
    element.focus();
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    element.textContent = text;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  async function waitForElement(selectors, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = queryFirst(selectors);
      if (found) return found;
      await sleep(250);
    }
    return null;
  }

  async function findBySelectorsOrText(selectors, textPattern, timeout, buttonsOnly = false) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const direct = queryFirst(selectors);
      if (direct) return direct;
      const candidates = document.querySelectorAll(buttonsOnly ? 'button' : 'button, [role="button"]');
      const byText = Array.from(candidates).find(element => textPattern.test((element.textContent || '').trim()));
      if (byText) return byText;
      await sleep(250);
    }
    return null;
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

  // ═══════════════════════════════════════════════════════════════════════
  // SEARCH RESULT LIST SCRAPERS (KandiScout)
  // ═══════════════════════════════════════════════════════════════════════

  function scrapeLinkedInSearchResults() {
    const out = [];
    const cards = document.querySelectorAll('li.reusable-search__result-container, div[data-view-name="search-entity-result-universal-template"], li[class*="result-container"]');
    cards.forEach(card => {
      try {
        const link = card.querySelector('a[href*="/in/"]');
        if (!link) return;
        const profileUrl = link.href.split('?')[0];
        const nameEl = card.querySelector('span[aria-hidden="true"], span[dir="ltr"] > span');
        const name = (nameEl ? nameEl.textContent : link.textContent).trim().replace(/\s+/g, ' ');
        if (!name || name.length < 3) return;
        const subtitleEls = card.querySelectorAll('div[class*="subtitle"], .entity-result__primary-subtitle, .entity-result__secondary-subtitle');
        const position = subtitleEls[0] ? subtitleEls[0].textContent.trim() : '';
        const location = subtitleEls[1] ? subtitleEls[1].textContent.trim() : '';
        out.push({ displayName: name, position, location, profileUrl });
      } catch (e) {}
    });
    return dedupeByUrl(out);
  }

  function scrapeXingSearchResults() {
    const out = [];
    const cards = document.querySelectorAll('a[href*="/profile/"], article');
    const seen = new Set();
    cards.forEach(card => {
      try {
        const link = card.matches('a[href*="/profile/"]') ? card : card.querySelector('a[href*="/profile/"]');
        if (!link) return;
        const profileUrl = link.href.split('?')[0];
        if (seen.has(profileUrl)) return;
        const root = card.closest('article') || card;
        const nameEl = root.querySelector('h2, h3, [class*="name"]');
        const name = nameEl ? nameEl.textContent.trim().replace(/\s+/g, ' ') : '';
        if (!name || name.length < 3) return;
        seen.add(profileUrl);
        const posEl = root.querySelector('p, [class*="occupation"], [class*="position"]');
        out.push({
          displayName: name,
          position: posEl ? posEl.textContent.trim() : '',
          profileUrl,
        });
      } catch (e) {}
    });
    return out.slice(0, 25);
  }

  function dedupeByUrl(list) {
    const seen = new Set();
    return list.filter(c => {
      if (seen.has(c.profileUrl)) return false;
      seen.add(c.profileUrl);
      return true;
    }).slice(0, 25);
  }
})();
