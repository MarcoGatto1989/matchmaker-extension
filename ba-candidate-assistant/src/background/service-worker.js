import { normalizeCandidateSnapshot } from '../domain/candidate.js';
import { matchCandidateToProject, rankProjects } from '../domain/match-engine.js';
import { composeMessage } from '../domain/message-composer.js';
import { normalizeProject } from '../domain/project.js';
import { mergeSeenReference } from '../domain/seen-reference.js';
import { orphanedCandidateReferencesAfterProjectRemoval } from '../domain/project-bound-persistence.js';
import { classifyVisibleSearchCards } from '../domain/search-review.js';
import { markProjectDraftsSent } from '../domain/draft-lifecycle.js';
import { makeId } from '../shared/ids.js';
import { makeBackup, parseBackup } from '../storage/backup.js';
import { runRetentionCleanup } from '../storage/cleanup.js';
import {
  candidatesRepo,
  deleteAllLocalData,
  draftsRepo,
  getSettings,
  linksRepo,
  projectsRepo,
  putSettings,
  replaceAll,
  seenRepo,
  snapshotAll
} from '../storage/repositories.js';

const PRODUCT = 'BA Kandidaten';
let lastCleanupAt = 0;

async function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanupAt < 6 * 60 * 60 * 1000) return;
  lastCleanupAt = now;
  try { await runRetentionCleanup(now); } catch (error) { console.warn(`${PRODUCT}: retention cleanup failed`, error); }
}

async function touchSeen(reference, outcome, reasonCode) {
  if (!reference) return null;
  const current = await seenRepo.get(reference);
  const options = { reference, now: new Date().toISOString() };
  if (outcome !== undefined) options.outcome = outcome;
  if (reasonCode !== undefined) options.reasonCode = reasonCode;
  const next = mergeSeenReference(current, options);
  await seenRepo.put(next);
  return next;
}

async function getSearchView(cards = []) {
  const existing = new Map();
  for (const card of cards) {
    if (!card?.reference || existing.has(card.reference)) continue;
    const row = await seenRepo.get(card.reference);
    if (row) existing.set(card.reference, row);
  }
  const view = classifyVisibleSearchCards(cards, existing);
  for (const card of view.cards) {
    if (card.reference) await touchSeen(card.reference);
  }
  return view;
}

async function getProfileView(snapshotInput) {
  const candidate = normalizeCandidateSnapshot(snapshotInput);
  if (candidate.reference) await touchSeen(candidate.reference);
  const projects = await projectsRepo.all();
  const matches = rankProjects(candidate, projects).map(({ project, match }) => ({ project, match }));
  const existingLinks = candidate.reference ? await linksRepo.byCandidate(candidate.reference) : [];
  const drafts = candidate.reference ? await draftsRepo.byCandidate(candidate.reference) : [];
  return { candidate, matches, existingLinks, drafts };
}

async function associateCandidate(snapshotInput, projectId) {
  const candidate = normalizeCandidateSnapshot(snapshotInput);
  if (!candidate.reference) throw new Error('BA-Referenznummer fehlt; Kandidat kann nicht dauerhaft gespeichert werden.');
  if (candidate.confidence < 0.5) throw new Error('Parser-Konfidenz zu niedrig. Profil bitte prüfen, bevor es einem Projekt zugeordnet wird.');
  const project = await projectsRepo.get(projectId);
  if (!project) throw new Error('Projekt nicht gefunden.');
  const now = new Date().toISOString();
  const match = matchCandidateToProject(candidate, project);
  const stored = { ...candidate, updatedAt: now };
  await candidatesRepo.put(stored);
  await touchSeen(candidate.reference, 'unreviewed');
  const existing = (await linksRepo.byCandidate(candidate.reference)).find(link => link.projectId === projectId);
  const link = {
    id: existing?.id || `${candidate.reference}::${projectId}`,
    candidateReference: candidate.reference,
    projectId,
    match,
    recruiterDecision: existing?.recruiterDecision || 'project_linked',
    contactState: existing?.contactState || 'not_contacted',
    notes: existing?.notes || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  await linksRepo.put(link);
  return { candidate: stored, project, link };
}

async function createDraft(snapshotInput, projectId) {
  const candidate = normalizeCandidateSnapshot(snapshotInput);
  if (!candidate.reference) throw new Error('BA-Referenznummer fehlt.');
  const project = await projectsRepo.get(projectId);
  if (!project) throw new Error('Projekt nicht gefunden.');
  const text = composeMessage(candidate, project);
  const now = new Date().toISOString();
  const draft = {
    id: makeId('draft'),
    candidateReference: candidate.reference,
    projectId,
    text,
    status: 'draft',
    createdAt: now,
    updatedAt: now
  };
  await draftsRepo.put(draft);
  const links = await linksRepo.byCandidate(candidate.reference);
  const link = links.find(item => item.projectId === projectId);
  if (link) await linksRepo.put({ ...link, recruiterDecision: 'message_prepared', updatedAt: now });
  return draft;
}

async function markContacted(reference, projectId) {
  const links = await linksRepo.byCandidate(reference);
  const link = links.find(item => item.projectId === projectId);
  if (!link) throw new Error('Projektzuordnung nicht gefunden.');
  const now = new Date().toISOString();
  const next = { ...link, recruiterDecision: 'contacted', contactState: 'contacted', updatedAt: now };
  await linksRepo.put(next);
  const drafts = await draftsRepo.byCandidate(reference);
  for (const draft of markProjectDraftsSent(drafts, projectId, now)) {
    if (draft.projectId === projectId) await draftsRepo.put(draft);
  }
  await touchSeen(reference, 'contacted_elsewhere');
  const candidate = await candidatesRepo.get(reference);
  if (candidate) await candidatesRepo.put({ ...candidate, updatedAt: now });
  return next;
}

async function handleMessage(message) {
  await maybeCleanup();
  switch (message?.type) {
    case 'BAK_GET_SEARCH_VIEW': return getSearchView(message.cards || []);
    case 'BAK_GET_PROFILE_VIEW': return getProfileView(message.snapshot);
    case 'BAK_ASSOCIATE': return associateCandidate(message.snapshot, message.projectId);
    case 'BAK_CREATE_DRAFT': return createDraft(message.snapshot, message.projectId);
    case 'BAK_UPDATE_DRAFT': {
      const current = await draftsRepo.byCandidate(message.candidateReference);
      const draft = current.find(item => item.id === message.draftId);
      if (!draft) throw new Error('Nachrichtenentwurf nicht gefunden.');
      const next = { ...draft, text: String(message.text || ''), status: message.status || draft.status, updatedAt: new Date().toISOString() };
      await draftsRepo.put(next);
      return next;
    }
    case 'BAK_MARK_CONTACTED': return markContacted(message.candidateReference, message.projectId);
    case 'BAK_UPDATE_LINK_NOTE': {
      const links = await linksRepo.byCandidate(message.candidateReference);
      const link = links.find(item => item.projectId === message.projectId);
      if (!link) throw new Error('Projektzuordnung nicht gefunden.');
      const now = new Date().toISOString();
      const next = { ...link, notes: String(message.notes || '').trim().slice(0, 4000), updatedAt: now };
      await linksRepo.put(next);
      const candidate = await candidatesRepo.get(message.candidateReference);
      if (candidate) await candidatesRepo.put({ ...candidate, updatedAt: now });
      return next;
    }
    case 'BAK_SET_SEEN_OUTCOME': return touchSeen(message.reference, message.outcome, message.reasonCode || null);
    case 'BAK_LIST_PROJECTS': return (await projectsRepo.all()).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    case 'BAK_UPSERT_PROJECT': {
      const current = message.project?.id ? await projectsRepo.get(message.project.id) : null;
      const project = normalizeProject({ ...current, ...message.project, createdAt: current?.createdAt });
      if (!project.name) throw new Error('Projektname fehlt.');
      await projectsRepo.put(project);
      return project;
    }
    case 'BAK_DELETE_PROJECT': {
      const allLinks = await linksRepo.all();
      const links = allLinks.filter(link => link.projectId === message.projectId);
      if (links.length && !message.force) throw new Error('Projekt enthält Kandidatenzuordnungen. Erst archivieren oder Löschen bestätigen.');
      const orphanedReferences = orphanedCandidateReferencesAfterProjectRemoval(allLinks, message.projectId);
      const drafts = await draftsRepo.byProject(message.projectId);
      for (const draft of drafts) await draftsRepo.delete(draft.id);
      for (const link of links) await linksRepo.delete(link.id);
      for (const reference of orphanedReferences) await candidatesRepo.delete(reference);
      await projectsRepo.delete(message.projectId);
      return { deleted: true, deletedCandidateSnapshots: orphanedReferences.length };
    }
    case 'BAK_GET_DASHBOARD': return snapshotAll();
    case 'BAK_GET_SETTINGS': return getSettings();
    case 'BAK_SAVE_SETTINGS': await putSettings(message.settings || {}); return getSettings();
    case 'BAK_CLEANUP': return runRetentionCleanup();
    case 'BAK_EXPORT': return makeBackup(await snapshotAll());
    case 'BAK_IMPORT': {
      const data = parseBackup(message.backup);
      await replaceAll(data);
      return { imported: true };
    }
    case 'BAK_DELETE_ALL': await deleteAllLocalData(); return { deleted: true };
    default: throw new Error(`Unbekannte BA-Kandidaten-Aktion: ${message?.type || 'leer'}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!String(message?.type || '').startsWith('BAK_')) return false;
  handleMessage(message)
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/index.html') });
});

chrome.runtime.onInstalled.addListener(() => {
  maybeCleanup();
});
