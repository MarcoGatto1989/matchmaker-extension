const state = { page: 'today', data: null };
const content = document.querySelector('#content');
const title = document.querySelector('#page-title');
const subtitle = document.querySelector('#page-subtitle');
const flash = document.querySelector('#flash');
const dialog = document.querySelector('#project-dialog');
const form = document.querySelector('#project-form');

const pageMeta = {
  today: ['Heute', 'Dein aktueller BA-Kandidaten-Überblick.'],
  candidates: ['Kandidaten', 'Ausschließlich projektbezogen gespeicherte BA-Profile.'],
  projects: ['Projekte', 'Konkrete Recruiting-Mandate und Matching-Kriterien.'],
  messages: ['Nachrichten', 'Vorbereitete Entwürfe und lokal bestätigte Kontaktstatus.'],
  settings: ['Einstellungen', 'Datenschutz, Aufbewahrung sowie Import und Export.']
};

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[char]); }
function list(value) { return String(value || '').split(',').map(item => item.trim()).filter(Boolean); }
function date(value) { if (!value) return '–'; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? esc(value) : parsed.toLocaleDateString('de-DE'); }
function download(filename, contentValue, type = 'application/json') { const blob = new Blob([contentValue], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || 'Aktion fehlgeschlagen.'));
      resolve(response.data);
    });
  });
}

function notify(message, error = false) {
  flash.hidden = false; flash.textContent = message; flash.className = `flash${error ? ' error' : ''}`;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { flash.hidden = true; }, 5000);
}

async function refresh() { state.data = await send({ type:'BAK_GET_DASHBOARD' }); render(); }

function render() {
  const meta = pageMeta[state.page]; title.textContent = meta[0]; subtitle.textContent = meta[1];
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === state.page));
  if (!state.data) return;
  ({ today: renderToday, candidates: renderCandidates, projects: renderProjects, messages: renderMessages, settings: renderSettings })[state.page]();
}

function renderToday() {
  const d = state.data; const today = new Date().toISOString().slice(0,10);
  const seenToday = d.seenReferences.filter(item => String(item.lastSeen || '').startsWith(today));
  const linkedToday = d.links.filter(item => String(item.createdAt || '').startsWith(today));
  const contactedToday = d.links.filter(item => item.contactState === 'contacted' && String(item.updatedAt || '').startsWith(today));
  const strong = d.links.filter(item => ['strong','good'].includes(item.match?.classification)).length;
  content.innerHTML = `
    <div class="grid">
      <div class="metric"><strong>${seenToday.length}</strong><span>heute gesehene Referenzen</span></div>
      <div class="metric"><strong>${linkedToday.length}</strong><span>heute projektbezogen gespeichert</span></div>
      <div class="metric"><strong>${strong}</strong><span>starke/gute gespeicherte Matches</span></div>
      <div class="metric"><strong>${contactedToday.length}</strong><span>heute als kontaktiert markiert</span></div>
    </div>
    <div class="section"><div class="section-head"><h2>Letzte Projektzuordnungen</h2></div>${linksTable(d.links.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,12))}</div>
    <div class="section"><div class="section-head"><h2>Arbeitsweise</h2></div><div class="card muted">Öffne die BA Bewerberbörse manuell und wähle deine gespeicherte Suche. BA Kandidaten wertet ausschließlich bereits sichtbare Treffer und Profile aus. Kein Crawler, keine versteckten Tabs und kein automatischer Versand.</div></div>`;
}

function projectName(id) { return state.data.projects.find(project => project.id === id)?.name || 'Unbekanntes Projekt'; }
function candidate(reference) { return state.data.candidates.find(item => item.reference === reference); }
function linksTable(links) {
  if (!links.length) return '<div class="card empty">Noch keine Projektzuordnungen.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Referenz</th><th>Projekt</th><th>Match</th><th>Status</th><th>Aktualisiert</th></tr></thead><tbody>${links.map(link => `<tr><td>${esc(link.candidateReference)}</td><td>${esc(projectName(link.projectId))}</td><td><span class="score">${Number(link.match?.score || 0)}%</span> <span class="chip blue">${esc(link.match?.classification || '')}</span></td><td><span class="chip ${link.contactState==='contacted'?'good':''}">${esc(link.contactState || link.recruiterDecision)}</span></td><td>${date(link.updatedAt)}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderCandidates() {
  const rows = state.data.candidates.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (!rows.length) { content.innerHTML = '<div class="card empty">Noch keine Kandidaten projektbezogen gespeichert.</div>'; return; }
  content.innerHTML = `<div class="table-wrap"><table><thead><tr><th>BA-Referenz</th><th>Gesuchte Tätigkeit</th><th>Ort</th><th>Erfahrung</th><th>Projekte</th><th>Letzte Änderung</th></tr></thead><tbody>${rows.map(c => { const links = state.data.links.filter(link => link.candidateReference===c.reference); return `<tr><td>${esc(c.reference)}</td><td>${esc(c.desiredRoles?.join(' · ') || '–')}</td><td>${esc([c.postalCode,c.location].filter(Boolean).join(' ') || '–')}${c.radiusKm!=null?` · ${c.radiusKm} km`:''}</td><td>${c.experienceYears!=null?`${c.experienceYears} Jahre`:'–'}</td><td>${links.map(link=>`<span class="chip blue">${esc(projectName(link.projectId))} ${link.match?.score||0}%</span>`).join(' ')}</td><td>${date(c.updatedAt || c.capturedAt)}</td></tr>`; }).join('')}</tbody></table></div>`;
}

function renderProjects() {
  const projects = state.data.projects.slice().sort((a,b)=>a.name.localeCompare(b.name,'de'));
  content.innerHTML = `<div class="section-head"><h2>${projects.length} Projekte</h2><div><button class="btn secondary" id="csv-projects">CSV importieren</button></div></div><div class="project-grid">${projects.map(project => { const count = state.data.links.filter(link=>link.projectId===project.id).length; return `<article class="project-card"><div><span class="chip ${project.status==='active'?'good':''}">${esc(project.status)}</span></div><h3>${esc(project.name)}</h3><p>${esc(project.clientName || 'Kein Kundenname hinterlegt')}</p><div style="margin-top:10px"><span class="chip blue">${count} Kandidaten</span> <span class="chip">${esc(project.targetRoles?.slice(0,2).join(' · ') || 'keine Zielrolle')}</span></div><div class="actions"><button class="mini" data-edit-project="${esc(project.id)}">Bearbeiten</button><button class="mini" data-archive-project="${esc(project.id)}">${project.status==='archived'?'Aktivieren':'Archivieren'}</button><button class="mini" data-delete-project="${esc(project.id)}">Löschen</button></div></article>`; }).join('') || '<div class="card empty">Lege zuerst ein konkretes Recruiting-Projekt an.</div>'}</div>`;
  content.querySelector('#csv-projects')?.addEventListener('click',()=>document.querySelector('#project-csv-file').click());
  content.querySelectorAll('[data-edit-project]').forEach(btn=>btn.addEventListener('click',()=>openProject(state.data.projects.find(p=>p.id===btn.dataset.editProject))));
  content.querySelectorAll('[data-archive-project]').forEach(btn=>btn.addEventListener('click',async()=>{ const p=state.data.projects.find(x=>x.id===btn.dataset.archiveProject); await send({type:'BAK_UPSERT_PROJECT',project:{...p,status:p.status==='archived'?'active':'archived'}}); await refresh(); }));
  content.querySelectorAll('[data-delete-project]').forEach(btn=>btn.addEventListener('click',async()=>{ if(!confirm('Projekt und zugehörige lokale Verknüpfungen wirklich löschen?'))return; try{await send({type:'BAK_DELETE_PROJECT',projectId:btn.dataset.deleteProject,force:true});notify('Projekt gelöscht.');await refresh();}catch(error){notify(error.message,true);} }));
}

function renderMessages() {
  const rows = state.data.drafts.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (!rows.length) { content.innerHTML = '<div class="card empty">Noch keine Nachrichtenentwürfe.</div>'; return; }
  content.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Kandidat</th><th>Projekt</th><th>Status</th><th>Entwurf</th><th>Datum</th></tr></thead><tbody>${rows.map(draft => `<tr><td>${esc(draft.candidateReference)}</td><td>${esc(projectName(draft.projectId))}</td><td><span class="chip ${draft.status==='marked_sent'?'good':'blue'}">${esc(draft.status)}</span></td><td style="max-width:520px;white-space:pre-wrap">${esc(draft.text)}</td><td>${date(draft.updatedAt)}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderSettings() {
  const s = state.data.settings || {};
  content.innerHTML = `<div class="settings-grid">
    <div class="settings-card"><h3>Aufbewahrung</h3><p>Vollständige Kandidatenprofile existieren nur bei Projektzuordnung. Nicht zugeordnete Referenzen bleiben minimal.</p><div class="inline-form"><label>Projektprofile (Tage)<input id="candidate-days" type="number" min="1" value="${Number(s.candidateDays||90)}"></label><label>Nur gesehen (Tage)<input id="seen-days" type="number" min="1" value="${Number(s.seenDays||30)}"></label><button class="btn primary" id="save-retention">Speichern</button></div><div class="actions" style="margin-top:12px"><button class="btn secondary" id="cleanup">Jetzt bereinigen</button></div></div>
    <div class="settings-card"><h3>Backup</h3><p>JSON-Backup enthält ausschließlich lokale BA-Kandidaten-Daten. Es wird nicht automatisch hochgeladen.</p><div class="actions"><button class="btn secondary" id="export-json">JSON exportieren</button><button class="btn secondary" id="import-json">JSON wiederherstellen</button><button class="btn secondary" id="export-csv">Reporting-CSV</button></div></div>
    <div class="settings-card"><h3>Datenschutz</h3><p>BA Kandidaten speichert keine Passwörter, Passkeys, 2FA-Daten oder BA-Cookies. Es gibt keinen Cloud-Sync und keine Hintergrundsuche.</p><div class="actions"><button class="btn danger" id="delete-all">Alle lokalen Daten löschen</button></div></div>
    <div class="settings-card"><h3>Parser-Diagnose</h3><p>Bei Änderungen am BA-Markup wird die Erkennungsqualität im Profil angezeigt. Unsichere Profile können nicht projektbezogen gespeichert werden, solange die Mindestkonfidenz unterschritten ist.</p><div class="muted">Produkt: BA Kandidaten · Version 1.0.0</div></div>
  </div>`;
  content.querySelector('#save-retention').addEventListener('click',async()=>{await send({type:'BAK_SAVE_SETTINGS',settings:{candidateDays:Number(content.querySelector('#candidate-days').value),seenDays:Number(content.querySelector('#seen-days').value)}});notify('Aufbewahrung gespeichert.');await refresh();});
  content.querySelector('#cleanup').addEventListener('click',async()=>{const result=await send({type:'BAK_CLEANUP'});notify(`Bereinigung abgeschlossen: ${result.deletedCandidates} Kandidaten, ${result.deletedSeenReferences} Referenzen.`);await refresh();});
  content.querySelector('#export-json').addEventListener('click',exportJson);
  content.querySelector('#import-json').addEventListener('click',()=>document.querySelector('#backup-file').click());
  content.querySelector('#export-csv').addEventListener('click',exportCsv);
  content.querySelector('#delete-all').addEventListener('click',async()=>{if(!confirm('Wirklich alle lokalen BA-Kandidaten-Daten löschen?'))return;await send({type:'BAK_DELETE_ALL'});notify('Lokale Daten gelöscht.');await refresh();});
}

function openProject(project = null) {
  form.reset();
  for (const element of form.elements) {
    if (!element.name) continue;
    let value = '';
    if (project) {
      if (element.name === 'senderName') value = project.outreach?.senderName || '';
      else if (element.name === 'discloseClient') value = project.outreach?.discloseClient || false;
      else value = project[element.name] ?? '';
    }
    if (element.type === 'checkbox') element.checked = Boolean(value);
    else if (Array.isArray(value)) element.value = value.join(', ');
    else element.value = value;
  }
  dialog.showModal();
}

form.addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const f = new FormData(form);
  const project = {
    id:f.get('id')||undefined,name:f.get('name'),clientName:f.get('clientName'),targetRoles:list(f.get('targetRoles')),
    mustHaveSkills:list(f.get('mustHaveSkills')),preferredSkills:list(f.get('preferredSkills')),
    minimumExperience:f.get('minimumExperience')===''?null:Number(f.get('minimumExperience')),experienceHard:f.get('experienceHard')==='on',
    targetLocations:list(f.get('targetLocations')),maxRadiusKm:f.get('maxRadiusKm')===''?null:Number(f.get('maxRadiusKm')),workTimes:list(f.get('workTimes')),
    requiredLanguages:list(f.get('requiredLanguages')),languageHard:f.get('languageHard')==='on',recruiterNotes:f.get('recruiterNotes'),
    outreach:{senderName:f.get('senderName'),discloseClient:f.get('discloseClient')==='on'}
  };
  try { await send({type:'BAK_UPSERT_PROJECT',project}); dialog.close(); notify('Projekt gespeichert.'); await refresh(); } catch(error){ notify(error.message,true); }
});

async function exportJson() { const backup = await send({type:'BAK_EXPORT'}); download(`ba-kandidaten-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backup,null,2)); }
function exportCsv() { const header=['BA-Referenz','Projekt','Match','Klassifikation','Kontaktstatus','Ort','Rollen']; const rows=state.data.links.map(link=>{const c=candidate(link.candidateReference)||{};return [link.candidateReference,projectName(link.projectId),link.match?.score||0,link.match?.classification||'',link.contactState||'',[c.postalCode,c.location].filter(Boolean).join(' '),(c.desiredRoles||[]).join(' | ')];}); const csv=[header,...rows].map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(';')).join('\n'); download(`ba-kandidaten-report-${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8'); }

function parseCsv(text) {
  const lines=text.split(/\r?\n/).filter(Boolean); if(!lines.length)return[];
  const headers=lines[0].split(';').map(h=>h.replace(/^"|"$/g,'').trim().toLowerCase());
  return lines.slice(1).map(line=>{const values=line.split(';').map(v=>v.replace(/^"|"$/g,'').replace(/""/g,'"').trim());const row=Object.fromEntries(headers.map((h,i)=>[h,values[i]||'']));return {name:row.projekt||row.name||row.projektname,targetRoles:list(row.zielrollen||row.rollen),mustHaveSkills:list(row.musskenntnisse||row['muss-kenntnisse']),preferredSkills:list(row.wunschkenntnisse||row['bevorzugte kenntnisse']),targetLocations:list(row.orte||row.zielorte),minimumExperience:row.mindesterfahrung?Number(row.mindesterfahrung):null,workTimes:list(row.arbeitszeit),requiredLanguages:list(row.sprachen)};}).filter(row=>row.name);
}

document.querySelector('#backup-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{const backup=JSON.parse(await file.text());await send({type:'BAK_IMPORT',backup});notify('Backup wiederhergestellt.');await refresh();}catch(error){notify(error.message,true);}finally{event.target.value='';}});
document.querySelector('#project-csv-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{const rows=parseCsv(await file.text());for(const project of rows)await send({type:'BAK_UPSERT_PROJECT',project});notify(`${rows.length} Projekte importiert.`);await refresh();}catch(error){notify(error.message,true);}finally{event.target.value='';}});

document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{state.page=button.dataset.page;render();}));
document.querySelector('#new-project').addEventListener('click',()=>openProject());
document.querySelector('#open-ba').addEventListener('click',()=>window.open('https://www.arbeitsagentur.de/bewerberboerse','_blank','noopener,noreferrer'));

refresh().catch(error=>notify(error.message,true));
