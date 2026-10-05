(() => {
  if (globalThis.__ESOS_LINKEDHELPER_BATCH_WORKER_V421__) return;
  globalThis.__ESOS_LINKEDHELPER_BATCH_WORKER_V421__ = true;

  const STATUS_KEY = 'esos_linkedhelper_runtime_v421';
  const META_KEY = 'esos_socialfinder_profile_metadata_v421';
  const SUCCESS_KEY = 'esos_network_sync_success_urls_v1';
  let stopRequested = false;
  let running = false;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function setStatus(patch) {
    const stored = await chrome.storage.local.get({ [STATUS_KEY]: {} });
    const next = { ...(stored[STATUS_KEY] || {}), ...patch, updatedAt: Date.now() };
    await chrome.storage.local.set({ [STATUS_KEY]: next });
    try { chrome.runtime.sendMessage({ type: 'ESOS_LINKEDHELPER_STATUS_PUSH', status: next }); } catch (_) {}
    return next;
  }

  async function sendTab(tabId, message, retries = 12, wait = 250) {
    let lastError = '';
    for (let i = 0; i < retries; i += 1) {
      try {
        const result = await chrome.tabs.sendMessage(tabId, message);
        if (result) return result;
      } catch (error) {
        lastError = error?.message || String(error);
      }
      await sleep(wait);
    }
    return { success: false, error: lastError || 'Profil-Tab antwortet nicht.' };
  }

  async function waitReady(tabId, timeout = 20000) {
    const end = Date.now() + timeout;
    let previousUrl = '';
    let stableSince = 0;
    while (Date.now() < end) {
      if (stopRequested) return false;
      try {
        const tab = await chrome.tabs.get(tabId);
        const url = String(tab?.url || '');
        if (url !== previousUrl) {
          previousUrl = url;
          stableSince = Date.now();
        }
        if (tab?.status === 'complete' && Date.now() - stableSince > 450) return true;
      } catch (_) {
        return false;
      }
      await sleep(220);
    }
    return false;
  }

  function profileKey(url, network) {
    try {
      const parsed = new URL(String(url || ''));
      const path = parsed.pathname.replace(/\/+$/, '');
      if (network === 'linkedin') {
        const m = path.match(/^\/in\/([^/]+)/i);
        return m?.[1] ? 'linkedin:' + decodeURIComponent(m[1]).toLowerCase() : '';
      }
      const m = path.match(/^\/(?:profile|pages)\/([^/]+)/i);
      return m?.[1] ? 'xing:' + decodeURIComponent(m[1]).toLowerCase() : '';
    } catch (_) {
      return '';
    }
  }

  function isAlready(result) {
    const detail = String(result?.detail || result?.reason || result?.error || '');
    return Boolean(result?.alreadyAssigned || result?.alreadyInSalesNavigator)
      || (/\b(bereits|already|gespeichert|saved)\b/i.test(detail)
        && !/\b(hinzugefügt|added|neu gespeichert|saved successfully)\b/i.test(detail));
  }

  async function scrape(tabId) {
    const result = await sendTab(tabId, { type: 'SCRAPE_PROFILE' }, 8, 220);
    return result?.success ? (result.data || {}) : {};
  }

  async function persistNew(network, url, candidateName, profileData) {
    const stored = await chrome.storage.local.get([SUCCESS_KEY, META_KEY]);
    const successes = Array.isArray(stored[SUCCESS_KEY]) ? stored[SUCCESS_KEY] : [];
    const wanted = profileKey(url, network) || String(url || '').trim().toLowerCase();
    const filtered = successes.filter(entry => {
      const entryNetwork = String(entry?.network || '').toLowerCase();
      const key = profileKey(entry?.url, entryNetwork) || String(entry?.url || '').trim().toLowerCase();
      return key !== wanted;
    });
    filtered.push({
      network,
      url,
      candidateName: String(candidateName || '').trim() || null,
      succeededAt: new Date().toISOString(),
    });

    const metadata = stored[META_KEY] && typeof stored[META_KEY] === 'object'
      ? { ...stored[META_KEY] }
      : {};
    const urlKey = String(url || '').trim().replace(/\/+$/, '').toLowerCase();
    metadata[urlKey] = {
      url,
      network,
      currentPosition: profileData?.currentPosition || '',
      currentCompany: profileData?.currentCompany || '',
      city: profileData?.companyCity || profileData?.locationFull || profileData?.location || '',
      gender: profileData?.gender || '',
      positionStartedAt: profileData?.positionStartedAt || profileData?.currentPositionStartedAt || '',
      observedAt: new Date().toISOString(),
      source: 'esos_ai_linkedhelper_v421',
    };

    await chrome.storage.local.set({
      [SUCCESS_KEY]: filtered.slice(-1000),
      [META_KEY]: metadata,
    });
  }

  async function closeTab(tabId) {
    try { await chrome.tabs.remove(tabId); } catch (_) {}
  }

  async function xingTabs() {
    const tabs = await chrome.tabs.query({
      url: ['https://xing.com/*', 'https://www.xing.com/*', 'https://*.xing.com/*'],
    });
    return (tabs || [])
      .filter(tab => Number.isInteger(tab.id) && /\/profile\//i.test(String(tab.url || '')))
      .sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index));
  }

  async function linkedinTabs() {
    const tabs = await chrome.tabs.query({
      url: ['https://linkedin.com/*', 'https://www.linkedin.com/*', 'https://*.linkedin.com/*'],
    });
    return (tabs || [])
      .filter(tab => Number.isInteger(tab.id) && /\/in\//i.test(String(tab.url || '')))
      .sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index));
  }

  async function runXing(project) {
    if (running) return;
    const targetProject = String(project || '').trim();
    if (!targetProject) {
      await setStatus({ running: false, network: 'xing', message: 'Bitte ein XING-Zielprojekt eingeben.' });
      return;
    }

    const tabs = await xingTabs();
    running = true;
    stopRequested = false;
    let added = 0, existing = 0, failed = 0;
    await setStatus({ running: true, network: 'xing', project: targetProject, current: 0, total: tabs.length, added, existing, failed, message: tabs.length + ' XING-Profile gefunden.' });

    try {
      for (let i = 0; i < tabs.length; i += 1) {
        if (stopRequested) break;
        const tab = tabs[i];
        const sourceUrl = String(tab.url || '');
        await setStatus({ current: i + 1, total: tabs.length, added, existing, failed, message: 'XING ' + (i + 1) + '/' + tabs.length + ': Profil wird verarbeitet …' });

        const profileData = await scrape(tab.id);
        const opened = await sendTab(tab.id, { type: 'ESOS_XING_OPEN_TALENT_MANAGER' });
        if (!opened?.success) {
          failed += 1;
          await setStatus({ added, existing, failed, lastError: opened?.error || opened?.reason || 'TalentManager konnte nicht geöffnet werden.' });
          continue;
        }

        if (opened?.navigating) {
          const ready = await waitReady(tab.id, 20000);
          if (!ready) {
            failed += 1;
            await setStatus({ added, existing, failed, lastError: 'TalentManager wurde nicht rechtzeitig geladen.' });
            continue;
          }
          await sleep(650);
        }

        const result = await sendTab(tab.id, {
          type: 'ESOS_XING_ADD_PROJECT',
          payload: { project_name: targetProject, project_url: '' },
        }, 18, 300);

        if (!result?.success) {
          failed += 1;
          await setStatus({ added, existing, failed, lastError: result?.error || result?.reason || 'Zum Projekt hinzufügen fehlgeschlagen.' });
          continue;
        }

        if (isAlready(result)) {
          existing += 1;
        } else {
          let saved = true;
          try { await persistNew('xing', sourceUrl, result?.candidateName || opened?.candidateName, profileData); }
          catch (_) { saved = false; }
          if (!saved) {
            failed += 1;
            await setStatus({ added, existing, failed, lastError: 'Profil-URL/Metadaten konnten nicht gespeichert werden; Tab bleibt offen.' });
            continue;
          }
          added += 1;
        }

        await setStatus({ added, existing, failed, lastError: '' });
        await closeTab(tab.id);
        await sleep(180);
      }
    } finally {
      running = false;
      await setStatus({
        running: false,
        network: 'xing',
        added, existing, failed,
        message: stopRequested
          ? 'Gestoppt: ' + added + ' neu · ' + existing + ' bereits vorhanden · ' + failed + ' Fehler.'
          : 'Fertig: ' + added + ' neu · ' + existing + ' bereits vorhanden · ' + failed + ' Fehler. Fehler-Tabs bleiben offen.',
      });
    }
  }

  async function runLinkedIn() {
    if (running) return;
    const tabs = await linkedinTabs();
    running = true;
    stopRequested = false;
    let added = 0, existing = 0, failed = 0;
    await setStatus({ running: true, network: 'linkedin', current: 0, total: tabs.length, added, existing, failed, message: tabs.length + ' LinkedIn-Profile gefunden.' });

    try {
      for (let i = 0; i < tabs.length; i += 1) {
        if (stopRequested) break;
        const tab = tabs[i];
        const sourceUrl = String(tab.url || '');
        await setStatus({ current: i + 1, total: tabs.length, added, existing, failed, message: 'LinkedIn ' + (i + 1) + '/' + tabs.length + ': Profil wird verarbeitet …' });

        const profileData = await scrape(tab.id);
        const result = await sendTab(tab.id, { type: 'ESOS_LINKEDIN_SAVE_SALES_NAV' }, 16, 280);

        if (!result?.success) {
          failed += 1;
          await setStatus({ added, existing, failed, lastError: result?.error || result?.reason || 'Speichern in Sales Navigator fehlgeschlagen.' });
          continue;
        }

        if (isAlready(result)) {
          existing += 1;
        } else {
          let saved = true;
          try { await persistNew('linkedin', sourceUrl, result?.candidateName, profileData); }
          catch (_) { saved = false; }
          if (!saved) {
            failed += 1;
            await setStatus({ added, existing, failed, lastError: 'Profil-URL/Metadaten konnten nicht gespeichert werden; Tab bleibt offen.' });
            continue;
          }
          added += 1;
        }

        await setStatus({ added, existing, failed, lastError: '' });
        await closeTab(tab.id);
        await sleep(180);
      }
    } finally {
      running = false;
      await setStatus({
        running: false,
        network: 'linkedin',
        added, existing, failed,
        message: stopRequested
          ? 'Gestoppt: ' + added + ' neu · ' + existing + ' bereits vorhanden · ' + failed + ' Fehler.'
          : 'Fertig: ' + added + ' neu · ' + existing + ' bereits vorhanden · ' + failed + ' Fehler. Fehler-Tabs bleiben offen.',
      });
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'ESOS_LINKEDHELPER_START_XING') {
      runXing(message.project).catch(error => setStatus({ running: false, message: error?.message || String(error) }));
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === 'ESOS_LINKEDHELPER_START_LINKEDIN') {
      runLinkedIn().catch(error => setStatus({ running: false, message: error?.message || String(error) }));
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === 'ESOS_LINKEDHELPER_STOP') {
      stopRequested = true;
      setStatus({ message: 'Stop angefordert – aktueller Schritt wird noch beendet …' });
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === 'ESOS_LINKEDHELPER_GET_STATUS') {
      chrome.storage.local.get({ [STATUS_KEY]: {} }).then(stored => sendResponse(stored[STATUS_KEY] || {}));
      return true;
    }
    return undefined;
  });
})();