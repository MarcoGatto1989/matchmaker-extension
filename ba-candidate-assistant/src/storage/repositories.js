import { STORES, clearStore, deleteOne, getAll, getByIndex, getOne, putOne } from './db.js';
import { DEFAULT_RETENTION } from './retention.js';

export const projectsRepo = {
  all: () => getAll(STORES.projects),
  get: id => getOne(STORES.projects, id),
  put: project => putOne(STORES.projects, project),
  delete: id => deleteOne(STORES.projects, id)
};

export const candidatesRepo = {
  all: () => getAll(STORES.candidates),
  get: reference => getOne(STORES.candidates, reference),
  put: candidate => putOne(STORES.candidates, candidate),
  delete: reference => deleteOne(STORES.candidates, reference)
};

export const seenRepo = {
  all: () => getAll(STORES.seenReferences),
  get: reference => getOne(STORES.seenReferences, reference),
  put: seen => putOne(STORES.seenReferences, seen),
  delete: reference => deleteOne(STORES.seenReferences, reference)
};

export const linksRepo = {
  all: () => getAll(STORES.links),
  byCandidate: reference => getByIndex(STORES.links, 'candidateReference', reference),
  byProject: projectId => getByIndex(STORES.links, 'projectId', projectId),
  put: link => putOne(STORES.links, link),
  delete: id => deleteOne(STORES.links, id)
};

export const draftsRepo = {
  all: () => getAll(STORES.drafts),
  byCandidate: reference => getByIndex(STORES.drafts, 'candidateReference', reference),
  byProject: projectId => getByIndex(STORES.drafts, 'projectId', projectId),
  put: draft => putOne(STORES.drafts, draft),
  delete: id => deleteOne(STORES.drafts, id)
};

export async function getSettings() {
  const row = await getOne(STORES.settings, 'global');
  return { ...DEFAULT_RETENTION, ...(row?.value || {}) };
}

export async function putSettings(value) {
  return putOne(STORES.settings, { key: 'global', value: { ...DEFAULT_RETENTION, ...value } });
}

export async function snapshotAll() {
  const [projects, candidates, seenReferences, links, drafts, settings] = await Promise.all([
    projectsRepo.all(), candidatesRepo.all(), seenRepo.all(), linksRepo.all(), draftsRepo.all(), getSettings()
  ]);
  return { projects, candidates, seenReferences, links, drafts, settings };
}

export async function replaceAll(data) {
  await Promise.all(Object.values(STORES).map(name => clearStore(name)));
  for (const project of data.projects || []) await projectsRepo.put(project);
  for (const candidate of data.candidates || []) await candidatesRepo.put(candidate);
  for (const seen of data.seenReferences || []) await seenRepo.put(seen);
  for (const link of data.links || []) await linksRepo.put(link);
  for (const draft of data.drafts || []) await draftsRepo.put(draft);
  await putSettings(data.settings || {});
}

export async function deleteAllLocalData() {
  await Promise.all(Object.values(STORES).map(name => clearStore(name)));
  await putSettings(DEFAULT_RETENTION);
}
