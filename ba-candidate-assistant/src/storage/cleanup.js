import { candidatesRepo, draftsRepo, getSettings, linksRepo, seenRepo, snapshotAll } from './repositories.js';
import { computeRetentionActions } from './retention.js';

export async function runRetentionCleanup(now = Date.now()) {
  const [snapshot, settings] = await Promise.all([snapshotAll(), getSettings()]);
  const actions = computeRetentionActions(snapshot, settings, now);
  for (const id of actions.draftIds) await draftsRepo.delete(id);
  for (const id of actions.linkIds) await linksRepo.delete(id);
  for (const reference of actions.candidateRefs) await candidatesRepo.delete(reference);
  for (const reference of [...actions.candidateRefs, ...actions.seenRefs]) await seenRepo.delete(reference);
  return {
    deletedCandidates: actions.candidateRefs.length,
    deletedSeenReferences: actions.seenRefs.length,
    deletedLinks: actions.linkIds.length,
    deletedDrafts: actions.draftIds.length
  };
}
