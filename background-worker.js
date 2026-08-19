// MatchMaker BOOT v3.5 worker wrapper
// Loads the established background runtime and replaces only the position-check
// handler so live profile checks drain their queue continuously.
importScripts('background.js');

runPositionCheck = async function(job, apiBase, token) {
  const payload = job.payload || {};
  const profileUrl = payload.profileUrl || job.linkedin_url;
  let tab;

  const report = async (success, data = null, platform = null, error = null) => {
    const response = await safeFetch(`${apiBase}/api/position-check-ext/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ jobId: job.id, success, data, platform, error }),
    }, 15000);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`ESOS-Rückgabe fehlgeschlagen (${response.status}) ${detail}`.trim());
    }
  };

  try {
    if (!/^https:\/\/(www\.)?(linkedin\.com|xing\.com)\//i.test(String(profileUrl || ''))) {
      await report(false, null, null, 'Ungültiger LinkedIn-/XING-Profillink.');
      return;
    }

    tab = await chrome.tabs.create({ url: profileUrl, active: false });
    try {
      await waitForTabReady(tab.id, 25000);
    } catch (error) {
      console.warn('[Positionsabgleich] Tab-Ready nicht bestätigt:', error.message);
    }
    await new Promise(resolve => setTimeout(resolve, 4500));

    const scraped = await new Promise(resolve => {
      const timer = setTimeout(() => resolve({ success: false, error: 'Zeitüberschreitung beim Auslesen des Profils.' }), 25000);
      chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_PROFILE' }, result => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(result || { success: false, error: 'Keine Antwort vom Profil-Scraper.' });
      });
    });

    if (!scraped.success) {
      await report(false, null, scraped.platform || payload.network || null, scraped.error || 'Profil konnte nicht ausgelesen werden.');
      return;
    }

    await report(true, scraped.data || {}, scraped.platform || payload.network || null, null);
    console.log(`[Positionsabgleich] ${job.candidate_name} live geprüft (${scraped.platform || payload.network || 'Profil'}).`);
  } catch (error) {
    console.error('[Positionsabgleich] Fehler:', error.message);
    try {
      await report(false, null, payload.network || null, error.message || 'Positionsprüfung fehlgeschlagen.');
    } catch (reportError) {
      console.error('[Positionsabgleich] Rückmeldung fehlgeschlagen:', reportError.message);
    }
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
    // A position check is an interactive ESOS task, not outreach. Continue quickly
    // with the next queued profile without consuming outreach daily limits.
    setTimeout(() => processNextJob(), 1200);
  }
};
