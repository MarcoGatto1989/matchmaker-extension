(() => {
  const root = globalThis.BAKandidaten = globalThis.BAKandidaten || {};
  let host;
  let body;
  let currentSnapshot = null;
  let currentView = null;
  let selectedProjectId = null;
  let currentDraft = null;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response?.ok) return reject(new Error(response?.error || 'BA Kandidaten: Aktion fehlgeschlagen.'));
        resolve(response.data);
      });
    });
  }

  function ensureHost() {
    if (host?.isConnected) return host;
    host = document.createElement('div');
    host.id = 'bak-root';
    host.dataset.open = 'false';
    host.innerHTML = `
      <button id="bak-toggle" type="button">BA Kandidaten</button>
      <section id="bak-panel" aria-label="BA Kandidaten">
        <header class="bak-head">
          <div><strong>BA Kandidaten</strong><small>Projektbezogene Bewerberprüfung</small></div>
          <button type="button" class="bak-close" aria-label="Schließen">×</button>
        </header>
        <div class="bak-body"></div>
      </section>`;
    document.documentElement.appendChild(host);
    body = host.querySelector('.bak-body');
    host.querySelector('#bak-toggle').addEventListener('click', () => { host.dataset.open = 'true'; });
    host.querySelector('.bak-close').addEventListener('click', () => { host.dataset.open = 'false'; });
    return host;
  }

  function setStatus(message, kind = '') {
    const target = body?.querySelector('[data-bak-status]');
    if (!target) return;
    target.className = `bak-status ${kind ? `bak-${kind}` : ''}`;
    target.textContent = message;
  }

  function chips(values = [], max = 8) {
    return values.slice(0, max).map(value => `<span class="bak-chip">${escapeHtml(value)}</span>`).join('');
  }

  async function renderSearch(cards = []) {
    ensureHost();
    currentSnapshot = null;
    currentView = null;
    currentDraft = null;
    host.querySelector('#bak-toggle').dataset.alert = cards.length > 0 ? 'true' : 'false';
    body.innerHTML = '<div class="bak-card"><div class="bak-title">Aktuelle BA-Suche wird geprüft…</div></div>';
    try {
      const view = await send({ type: 'BAK_GET_SEARCH_VIEW', cards });
      const { counts } = view;
      const labels = { new:'Neu', seen:'Gesehen', skipped:'Übersprungen', contacted:'Kontaktiert', unresolved:'Ohne Referenz' };
      const statusClass = status => status === 'new' ? 'bak-good' : status === 'contacted' ? 'bak-good' : '';
      body.innerHTML = `
        <div class="bak-card">
          <div class="bak-title">Aktuelle BA-Suche</div>
          <div class="bak-sub">Es werden ausschließlich Treffer ausgewertet, die auf dieser Seite bereits sichtbar gerendert sind. BA Kandidaten öffnet keine Profile selbstständig.</div>
          <div class="bak-row" style="margin-top:10px">
            <span class="bak-chip">${counts.total} sichtbar</span>
            <span class="bak-chip bak-good">${counts.new} neu</span>
            <span class="bak-chip">${counts.seen} gesehen</span>
            <span class="bak-chip">${counts.skipped} übersprungen</span>
            <span class="bak-chip">${counts.contacted} kontaktiert</span>
          </div>
        </div>
        ${(view.cards || []).slice(0, 20).map(card => `<div class="bak-card"><div class="bak-title">${escapeHtml(card.title)}</div><div class="bak-sub">${escapeHtml(card.summary)}</div><div class="bak-row" style="margin-top:7px">${card.reference ? `<span class="bak-chip">${escapeHtml(card.reference)}</span>` : ''}<span class="bak-chip ${statusClass(card.reviewStatus)}">${escapeHtml(labels[card.reviewStatus] || card.reviewStatus)}</span></div></div>`).join('') || '<div class="bak-empty">Keine eindeutig erkennbaren Treffer im bereits gerenderten Bereich.</div>'}
        <div class="bak-card"><div class="bak-sub">Öffne einen Kandidaten manuell. Sobald das Profil sichtbar ist, zeigt BA Kandidaten automatisch Matching, Projektzuordnung und Nachrichtenentwurf.</div></div>`;
    } catch (error) {
      body.innerHTML = `<div class="bak-card"><div class="bak-title bak-error">Suchstatus konnte nicht geladen werden</div><div class="bak-sub">${escapeHtml(error.message)}</div></div>`;
    }
  }

  function matchCard(item, index) {
    const { project, match } = item;
    const reasons = [...match.positives.slice(0, 2), ...match.concerns.slice(0, 1)].join(' · ');
    return `<div class="bak-card bak-match" data-match-project="${escapeHtml(project.id)}">
      <div class="bak-score">${match.score}%</div>
      <div class="bak-grow">
        <div class="bak-title">${escapeHtml(project.name)}</div>
        <div class="bak-sub">${escapeHtml(project.clientName || '')}${project.clientName ? ' · ' : ''}${escapeHtml(match.classification)} · Datenbasis ${match.confidence}%</div>
        <div class="bak-sub" style="margin-top:5px">${escapeHtml(reasons || 'Noch zu wenig Daten für eine detaillierte Begründung.')}</div>
        ${index === 0 ? '<span class="bak-chip bak-good">Bestes Match</span>' : ''}
      </div>
    </div>`;
  }

  async function loadProfile(snapshot) {
    ensureHost();
    currentSnapshot = snapshot;
    currentDraft = null;
    body.innerHTML = '<div class="bak-card"><div class="bak-title">Profil wird geprüft…</div></div>';
    try {
      currentView = await send({ type: 'BAK_GET_PROFILE_VIEW', snapshot });
      selectedProjectId = currentView.matches?.[0]?.project?.id || currentView.existingLinks?.[0]?.projectId || null;
      renderProfile();
    } catch (error) {
      body.innerHTML = `<div class="bak-card"><div class="bak-title bak-error">Profil konnte nicht verarbeitet werden</div><div class="bak-sub">${escapeHtml(error.message)}</div></div>`;
    }
  }

  function renderProfile() {
    const c = currentView.candidate;
    const linkedIds = new Set((currentView.existingLinks || []).map(link => link.projectId));
    const selectedLink = (currentView.existingLinks || []).find(link => link.projectId === selectedProjectId) || null;
    body.innerHTML = `
      <div class="bak-card">
        <div class="bak-title">${escapeHtml(c.desiredRoles?.[0] || 'BA-Kandidat/in')}</div>
        <div class="bak-sub">${escapeHtml(c.reference || 'Referenz nicht erkannt')} · ${escapeHtml(c.location || 'Ort unbekannt')}${c.radiusKm != null ? ` · ${c.radiusKm} km` : ''}</div>
        <div class="bak-row" style="margin-top:8px">${chips([...(c.workTimes || []), c.availability].filter(Boolean), 6)}</div>
        <div class="bak-row">${chips(c.skills || [], 8)}</div>
        <div class="bak-sub" style="margin-top:8px">Parser: ${Math.round(c.confidence * 100)}%${c.missingFields?.length ? ` · fehlt: ${escapeHtml(c.missingFields.join(', '))}` : ''}</div>
      </div>
      <div class="bak-title" style="padding:3px 3px 8px">Projekt-Matches</div>
      ${(currentView.matches || []).slice(0, 5).map(matchCard).join('') || '<div class="bak-card bak-empty">Noch keine aktiven Projekte. Lege Projekte im BA-Kandidaten-Dashboard an.</div>'}
      <div class="bak-card">
        <label class="bak-label" for="bak-project">Projekt auswählen</label>
        <select class="bak-select" id="bak-project">
          ${(currentView.matches || []).map(({ project, match }) => `<option value="${escapeHtml(project.id)}" ${project.id === selectedProjectId ? 'selected' : ''}>${escapeHtml(project.name)} — ${match.score}%${linkedIds.has(project.id) ? ' · zugeordnet' : ''}</option>`).join('')}
        </select>
        <div class="bak-actions">
          <button class="bak-btn primary" data-action="associate" ${!c.reference || !selectedProjectId ? 'disabled' : ''}>Projekt zuordnen</button>
          <button class="bak-btn" data-action="draft" ${!c.reference || !selectedProjectId ? 'disabled' : ''}>Nachricht vorbereiten</button>
          <button class="bak-btn" data-action="skip" ${!c.reference ? 'disabled' : ''}>Überspringen</button>
          <button class="bak-btn" data-action="contacted" ${!c.reference || !selectedProjectId || !selectedLink ? 'disabled' : ''}>Als kontaktiert markieren</button>
        </div>
        <label class="bak-label" for="bak-link-note">Notiz zum Projekt</label>
        <textarea class="bak-textarea" id="bak-link-note" data-link-note ${selectedLink ? '' : 'disabled'} placeholder="Erst nach Projektzuordnung verfügbar">${escapeHtml(selectedLink?.notes || '')}</textarea>
        <div class="bak-actions"><button class="bak-btn" data-action="save-note" ${selectedLink ? '' : 'disabled'}>Notiz speichern</button></div>
        <div data-bak-status class="bak-status"></div>
      </div>
      <div data-draft-slot></div>`;

    body.querySelector('#bak-project')?.addEventListener('change', event => { selectedProjectId = event.target.value; currentDraft = null; renderProfile(); });
    body.querySelector('[data-action="associate"]')?.addEventListener('click', associate);
    body.querySelector('[data-action="draft"]')?.addEventListener('click', draft);
    body.querySelector('[data-action="skip"]')?.addEventListener('click', skip);
    body.querySelector('[data-action="contacted"]')?.addEventListener('click', contacted);
    body.querySelector('[data-action="save-note"]')?.addEventListener('click', saveNote);
  }

  async function associate() {
    try {
      setStatus('Projektzuordnung wird gespeichert…');
      await send({ type: 'BAK_ASSOCIATE', snapshot: currentSnapshot, projectId: selectedProjectId });
      currentView = await send({ type: 'BAK_GET_PROFILE_VIEW', snapshot: currentSnapshot });
      renderProfile();
      setStatus('Kandidat ist projektbezogen gespeichert.', 'good');
    } catch (error) { setStatus(error.message, 'error'); }
  }

  async function draft() {
    try {
      setStatus('Nachrichtenentwurf wird erstellt…');
      const linked = currentView.existingLinks?.some(link => link.projectId === selectedProjectId);
      if (!linked) await send({ type: 'BAK_ASSOCIATE', snapshot: currentSnapshot, projectId: selectedProjectId });
      currentDraft = await send({ type: 'BAK_CREATE_DRAFT', snapshot: currentSnapshot, projectId: selectedProjectId });
      renderDraft();
      setStatus('Entwurf erstellt. Versand bleibt vollständig manuell.', 'good');
    } catch (error) { setStatus(error.message, 'error'); }
  }

  function renderDraft() {
    const slot = body.querySelector('[data-draft-slot]');
    if (!slot || !currentDraft) return;
    slot.innerHTML = `<div class="bak-card">
      <div class="bak-title">Nachrichtenentwurf</div>
      <textarea class="bak-textarea" data-draft-text>${escapeHtml(currentDraft.text)}</textarea>
      <div class="bak-actions">
        <button class="bak-btn primary" data-draft-action="insert">In BA-Nachricht übernehmen</button>
        <button class="bak-btn" data-draft-action="copy">Text kopieren</button>
      </div>
      <div class="bak-sub" style="margin-top:8px">BA Kandidaten klickt niemals auf „Senden“. Prüfe den Text im BA-Composer und versende ausschließlich selbst.</div>
      <div data-draft-status class="bak-status"></div>
    </div>`;
    slot.querySelector('[data-draft-text]').addEventListener('input', async event => {
      currentDraft.text = event.target.value;
    });
    slot.querySelector('[data-draft-action="copy"]').addEventListener('click', copyDraft);
    slot.querySelector('[data-draft-action="insert"]').addEventListener('click', insertDraft);
  }

  async function persistDraft(status) {
    const text = body.querySelector('[data-draft-text]')?.value ?? currentDraft.text;
    currentDraft = await send({ type: 'BAK_UPDATE_DRAFT', candidateReference: currentSnapshot.reference, draftId: currentDraft.id, text, status });
    return text;
  }

  async function copyDraft() {
    const target = body.querySelector('[data-draft-status]');
    try {
      const text = body.querySelector('[data-draft-text]')?.value ?? currentDraft.text;
      await navigator.clipboard.writeText(text);
      await persistDraft('copied_to_ba');
      target.textContent = 'Text kopiert.';
      target.className = 'bak-status bak-good';
    } catch (error) { target.textContent = error.message; target.className = 'bak-status bak-error'; }
  }

  function visibleEditable() {
    return root.messageField?.findVisibleBaMessageEditor(document, host) || null;
  }

  async function insertDraft() {
    const target = body.querySelector('[data-draft-status]');
    try {
      const editor = visibleEditable();
      if (!editor) throw new Error('Kein eindeutig sichtbares BA-Nachrichtenfeld gefunden. Nutze „Text kopieren“.');
      const text = await persistDraft('copied_to_ba');
      editor.focus();
      if (editor.matches('textarea, input')) editor.value = text;
      else editor.textContent = text;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      target.textContent = 'Text in das sichtbare Nachrichtenfeld eingesetzt. Bitte prüfen und selbst senden.';
      target.className = 'bak-status bak-good';
    } catch (error) { target.textContent = error.message; target.className = 'bak-status bak-error'; }
  }

  async function skip() {
    try {
      await send({ type: 'BAK_SET_SEEN_OUTCOME', reference: currentSnapshot.reference, outcome: 'skipped' });
      setStatus('Als übersprungen markiert.', 'good');
    } catch (error) { setStatus(error.message, 'error'); }
  }

  async function saveNote() {
    try {
      const notes = body.querySelector('[data-link-note]')?.value || '';
      await send({ type: 'BAK_UPDATE_LINK_NOTE', candidateReference: currentSnapshot.reference, projectId: selectedProjectId, notes });
      currentView = await send({ type: 'BAK_GET_PROFILE_VIEW', snapshot: currentSnapshot });
      renderProfile();
      setStatus('Notiz gespeichert.', 'good');
    } catch (error) { setStatus(error.message, 'error'); }
  }

  async function contacted() {
    try {
      await send({ type: 'BAK_MARK_CONTACTED', candidateReference: currentSnapshot.reference, projectId: selectedProjectId });
      setStatus('Lokal als kontaktiert markiert.', 'good');
    } catch (error) { setStatus(error.message, 'error'); }
  }

  function renderUnsupported() {
    ensureHost();
    host.querySelector('#bak-toggle').dataset.alert = 'false';
    body.innerHTML = '<div class="bak-card bak-empty">BA Kandidaten wartet auf eine Bewerberbörsen-Suche oder ein geöffnetes Kandidatenprofil.</div>';
  }

  root.panel = { ensureHost, renderSearch, loadProfile, renderUnsupported };
})();
