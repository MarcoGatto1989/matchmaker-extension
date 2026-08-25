const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_RETENTION = Object.freeze({ candidateDays: 90, seenDays: 30 });

export function isExpired(timestamp, days, now = Date.now()) {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return false;
  return now - value > Number(days) * DAY;
}

export function computeRetentionActions({ candidates = [], seenReferences = [], links = [], drafts = [] }, settings = {}, now = Date.now()) {
  const candidateDays = Number(settings.candidateDays || DEFAULT_RETENTION.candidateDays);
  const seenDays = Number(settings.seenDays || DEFAULT_RETENTION.seenDays);
  const expiredCandidateRefs = new Set(candidates.filter(item => isExpired(item.updatedAt || item.capturedAt, candidateDays, now)).map(item => item.reference));
  const expiredSeenRefs = new Set(seenReferences.filter(item => isExpired(item.lastSeen, seenDays, now)).map(item => item.reference));
  return {
    candidateRefs: [...expiredCandidateRefs],
    seenRefs: [...expiredSeenRefs].filter(ref => !expiredCandidateRefs.has(ref)),
    linkIds: links.filter(link => expiredCandidateRefs.has(link.candidateReference)).map(link => link.id),
    draftIds: drafts.filter(draft => expiredCandidateRefs.has(draft.candidateReference)).map(draft => draft.id)
  };
}
