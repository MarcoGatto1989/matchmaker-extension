// Copyright © 2026–present Marco Gatto. All rights reserved. Proprietary and confidential.
// Only the explicit "Aktuelle Suche importieren" click can start extraction.
const $ = id => document.getElementById(id);
const state = { tabId: null, provider: null, running: false, stopped: false,
  sessionId: '', total: 0, expected: null, cycles: 0, api: '', token: '' };
const DEFAULT_API = 'https://app.esos.cloud';
function hostOf(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:') return null;
    if (host === 'xing.com' || host.endsWith('.xing.com')) return 'xing';
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin';
  } catch (_) {}
  return null;
}
function sourceOf(url) {
  if (!hostOf(url)) return null;
  const s = hostOf(url);
  if (s === 'xing' && /talent|recruit/i.test(url)) return 'xing_talentmanager';
  if (s === 'linkedin' && /talent|recruit/i.test(url)) return 'linkedin_recruiter';
  return s;
}
function showMessage(text, isError = false) {
  $('detail').textContent = text;
  $('error').textContent = isError ? text : '';
}
async function getActiveSourceTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find(t => t.id && hostOf(t.url || ''));
  if (!tab) throw Error('Bitte zunächst eine XING-, XING-TalentManager- oder LinkedIn-Suchseite im selben Browserfenster öffnen.');
  return tab;
}
async function settings() {
  const saved = await chrome.storage.local.get(['esos_url', 'extension_token']);
  const raw = String(saved.esos_url || DEFAULT_API).trim();
  const api = /^https:\/\/(?:app\.esos\.cloud|esos\.cloud|www\.esos\.cloud|esos-frontend-test\.up\.railway\.app)(?:\/)?$/i.test(raw)
    ? raw.replace(/\/$/, '') : DEFAULT_API;
  return { api, token: saved.extension_token || '' };
}
async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(state.api + '/api/scout-capture' + path, {
      ...options, signal: controller.signal,
      headers: { Authorization: 'Bearer ' + state.token,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    let data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'ESOS antwortet mit HTTP ' + response.status);
    return data;
  } finally { clearTimeout(timer); }
}
async function init() {
  try {
    const tab = await getActiveSourceTab();
    state.tabId = tab.id; state.provider = sourceOf(tab.url);
    $('platform').value = (state.provider || '').replaceAll('_', ' ') + ' · ' + new URL(tab.url).hostname;
  } catch (error) {
    $('platform').value = 'Keine passende Suchseite';
    showMessage(error.message, true);
  }
  const conf = await settings();
  state.api = conf.api; state.token = conf.token;
  if (!state.token) { showMessage('Bitte zuerst in „Andere ESOS-AI-Funktionen“ den Extension-Token konfigurieren.', true); return; }
  try {
    const result = await api('/extension/projects');
    (result.projects || []).forEach(project => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = [project.mandateNumber, project.name].filter(Boolean).join(' · ');
      $('project').appendChild(option);
    });
  } catch (error) { showMessage('Projektliste nicht verfügbar: ' + error.message, true); }
}
$('tab-scout').addEventListener('click', () => {
  $('scout-ui').classList.remove('hidden'); $('existing-ui').classList.add('hidden');
  $('tab-scout').classList.remove('secondary'); $('tab-existing').classList.add('secondary');
});
$('tab-existing').addEventListener('click', () => {
  $('scout-ui').classList.add('hidden'); $('existing-ui').classList.remove('hidden');
  $('tab-scout').classList.add('secondary'); $('tab-existing').classList.remove('secondary');
});
function updateCounts() {
  $('counts').textContent = state.total + ' / ' + (state.expected ?? '–');
  $('bar').style.width = state.expected ? Math.min(100, state.total / state.expected * 100) + '%' : '0%';
  $('status').textContent = state.running ? 'Erfassung läuft' : 'Erfassung beendet';
}
const sleep = t => new Promise(r => setTimeout(r, t));

// This function executes in the already-open user tab (not in an additional browser window).
// Its selectors intentionally prefer same-card details and never invent missing information.
function captureVisibleSearchPage({ clickMore }) {
  const compact = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 250);
  const url = location.href;
  const source = location.hostname.includes('xing.com') ? 'xing' : 'linkedin';
  const matchUrl = href => {
    try {
      const u = new URL(href, location.href);
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      if (u.protocol !== 'https:' || host !== source + '.com') return null;
      const path = u.pathname.replace(/\/+$/, '');
      if (source === 'xing' ? !/^\/profile\/[^/]+$/i.test(path) : !/^\/in\/[^/]+$/i.test(path)) return null;
      return 'https://www.' + host + path;
    } catch (_) { return null; }
  };
  const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const urls = new Map();
  for (const link of document.querySelectorAll('a[href]')) {
    const profileUrl = matchUrl(link.href);
    if (!profileUrl || urls.has(profileUrl.toLowerCase())) continue;
    // Prefer a single result card to avoid combining two people's data.
    let root = link.closest('article,li,[data-view-name="search-entity-result-universal-template"],[data-qa*="member"],[class*="entity-result"],[class*="search-result"]');
    if (!root) root = link.parentElement?.parentElement?.parentElement || link;
    const name = compact(root.querySelector('h2,h3,[class*="name"],span[aria-hidden="true"]')?.textContent || link.textContent);
    if (name.length < 3 || name.length > 200) continue;
    const lines = (root.innerText || '').split('\n').map(compact).filter(Boolean);
    const unique = [...new Set(lines)].filter(s => s !== name && s.length > 2);
    const photo = root.querySelector('img[src],img[data-src]');
    const photoUrl = photo?.currentSrc || photo?.src || photo?.getAttribute('data-src') || null;
    const position = compact(root.querySelector('.entity-result__primary-subtitle,[class*="occupation"],[class*="position"],[data-qa*="occupation"]')?.textContent || unique[0] || '');
    const employer = compact(root.querySelector('[class*="company"],[class*="employer"],[data-qa*="company"]')?.textContent || '');
    const locationText = compact(root.querySelector('.entity-result__secondary-subtitle,[class*="location"],[data-qa*="location"]')?.textContent || '');
    urls.set(profileUrl.toLowerCase(), { profileUrl, displayName: name,
      position, employer, location: locationText, photoUrl:
      photoUrl && /^https:\/\//i.test(photoUrl) ? photoUrl : null });
  }
  // XING's "Mehr anzeigen" is a user-initiated continuation of this exact search.
  const more = [...document.querySelectorAll('button,a,[role="button"]')].find(el =>
    visible(el) && /^(mehr anzeigen|weitere anzeigen|show more|load more|mehr laden|weitere ergebnisse)$/i.test(compact(el.innerText || el.getAttribute('aria-label')))
  );
  // Some search providers render subsequent results on separate pages instead
  // of providing a "Mehr anzeigen" button. Advance the current tab in place.
  const next = !more && [...document.querySelectorAll('button,a,[role="button"]')].find(el =>
    visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
    (/(nächste seite|next page|weiter)/i.test(compact(el.innerText || el.getAttribute('aria-label'))) ||
      /^(next|nächste)$/i.test(compact(el.getAttribute('aria-label') || '')))
  );
  let clicked = false, clickedNext = false;
  if (clickMore && more && !more.disabled && more.getAttribute('aria-disabled') !== 'true') {
    more.click(); clicked = true;
  } else if (clickMore && next) {
    next.click(); clickedNext = true;
  } else if (clickMore) {
    // Trigger lazy-loading inside the results container, but do not scroll
    // the page endlessly or synthesize extra search queries.
    const scroller = document.querySelector('[class*="search-results"],[class*="results-list"],main');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }
  const text = document.body?.innerText || '';
  // Conservative count detection; human can correct it before starting.
  const counts = [...text.matchAll(/(\d{1,3}(?:[.,]\d{3})+|\d{1,5})\s+(?:Mitglieder|Ergebnisse|Personen|results|members)\b/gi)]
    .map(m => Number(m[1].replace(/[.,]/g, ''))).filter(n => n >= urls.size && n <= 10000);
  return { candidates: [...urls.values()], expected: counts.length ? counts[0] : null,
    clicked, clickedNext, hasMore: !!more || !!next, pageUrl: url };
}
async function readPageAndExpand() {
  const injected = await chrome.scripting.executeScript({
    target: { tabId: state.tabId }, func: captureVisibleSearchPage, args: [{ clickMore: true }],
  });
  return injected?.[0]?.result;
}
async function writeBatches(candidates, seen) {
  const fresh = candidates.filter(c => !seen.has(c.profileUrl.toLowerCase()));
  for (let i = 0; i < fresh.length; i += 100) {
    const chunk = fresh.slice(i, i + 100);
    const reply = await api('/extension/sessions/' + encodeURIComponent(state.sessionId) + '/items', {
      method: 'POST', body: JSON.stringify({ candidates: chunk }),
    });
    chunk.forEach(c => seen.add(c.profileUrl.toLowerCase()));
    state.total = reply.total;
    updateCounts();
  }
  return fresh.length;
}
$('cancel').addEventListener('click', () => { state.stopped = true; $('cancel').disabled = true; });
$('start').addEventListener('click', async () => {
  if (state.running) return;
  state.running = true; state.stopped = false; state.sessionId = ''; state.total = 0; state.cycles = 0;
  $('start').disabled = true; $('cancel').disabled = false; $('cancel').classList.remove('hidden');
  $('error').textContent = ''; $('success').textContent = ''; $('open-inbox').classList.add('hidden');
  let stopReason = '', stale = 0; const seen = new Set();
  try {
    const tab = await getActiveSourceTab();
    state.tabId = tab.id; state.provider = sourceOf(tab.url);
    const conf = await settings(); state.api = conf.api; state.token = conf.token;
    if (!state.token) throw Error('ESOS-Extension-Token fehlt.');
    const manuallyExpected = Number($('expected').value);
    state.expected = manuallyExpected > 0 ? manuallyExpected : null;
    const start = await api('/extension/sessions', { method: 'POST', body: JSON.stringify({
      source: state.provider, searchUrl: tab.url,
      title: 'Browsersuche · ' + new URL(tab.url).hostname + ' · ' + new Date().toLocaleString('de-DE'),
      expectedCount: state.expected, opportunityId: $('project').value || null,
    }) });
    state.sessionId = start.sessionId;
    $('open-inbox').href = state.api + '/tools/kandiscout';
    $('open-inbox').classList.remove('hidden');
    for (let cycle = 0; cycle < 180; cycle++) {
      if (state.stopped) { stopReason = 'Vom Benutzer gestoppt'; break; }
      const active = await chrome.tabs.get(state.tabId);
      if (!active.url || hostOf(active.url) !== hostOf(tab.url))
        { stopReason = 'Die Suchseite wurde gewechselt'; break; }
      const result = await readPageAndExpand();
      if (!result) { stopReason = 'Keine Suchergebnisse lesbar'; break; }
      if (result.pageUrl !== active.url) { stopReason = 'Die Suchseite hat sich geändert'; break; }
      if (state.expected === null && result.expected) state.expected = result.expected;
      if (state.expected) $('expected').value = String(state.expected);
      const count = await writeBatches(result.candidates, seen);
      state.cycles = cycle + 1; updateCounts();
      showMessage('Durchlauf ' + state.cycles + ': ' + state.total + ' verschiedene Profile gesichert. ' +
        (result.clicked ? '„Mehr anzeigen“ wurde betätigt.' : result.clickedNext ? 'Zur nächsten Ergebnisseite gewechselt.' : 'Keine weitere Schaltfläche gefunden.'));
      if (state.expected && state.total >= state.expected) break;
      if (count === 0) stale++; else stale = 0;
      if (!result.hasMore && !result.clicked && !result.clickedNext && stale >= 2) { stopReason = 'Keine weiteren Ergebnisse geladen'; break; }
      if (stale >= 5) { stopReason = 'Ergebniszahl erhöht sich nicht mehr'; break; }
      await sleep(result.clicked || result.clickedNext ? 1800 : 1200);
    }
    if (!stopReason && state.cycles >= 180 && (!state.expected || state.total < state.expected))
      stopReason = 'Sicherheitsgrenze von 180 Durchläufen erreicht';
  } catch (error) {
    stopReason = error?.message || String(error);
    showMessage('Erfassung fehlgeschlagen: ' + stopReason, true);
  } finally {
    if (state.sessionId) {
      try {
        const reply = await api('/extension/sessions/' + encodeURIComponent(state.sessionId) + '/finish', {
          method: 'POST', body: JSON.stringify({ expectedCount: state.expected, stopReason: state.total >= (state.expected ?? Infinity) ? null : stopReason }),
        });
        $('success').textContent = reply.complete
          ? 'Vollständig: ' + reply.capturedCount + ' Profile im Talent Scout gesichert. Jetzt manuell freigeben.'
          : 'Teilimport: ' + reply.capturedCount + ' / ' + (reply.expectedCount ?? 'unbekannt') +
          '. Keine CRM-Übernahme bis zur vollständigen Erfassung.';
      } catch (error) { showMessage('Abschluss konnte nicht gespeichert werden: ' + error.message, true); }
    }
    state.running = false; updateCounts();
    $('start').disabled = false; $('cancel').classList.add('hidden');
  }
});
init().catch(error => showMessage(error.message, true));
