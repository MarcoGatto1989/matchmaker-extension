const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_RETENTION = Object.freeze({ candidateDays: 90, seenDays: 30 });

export function isExpired(timestamp, days, now = Date.now()) {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return false;
  return now - value > Number(days) * DAY;
}

function latestTimestamp(...values) {
  let latest = null;
  let latestMs = -Infinity;
  for (const value of values.flat()) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || parsed <= latestMs) continue;
    latest = value;
    latestMs = parsed;
  }
  return latest;
}

export function computeRetentionActions({ candidates = [], seenReferences = [], links = [], drafts = [] }, settings = {}, now = Date.now()) {
  const candidateDays = Number(settings.candidateDays || DEFAULT_RETENTION.candidateDays);
  const seenDays = Number(settings.seenDays || DEFAULT_RETENTION.seenDays);
  const interactions = new Map();
  for (const link of links) {
    const values = interactions.get(link.candidateReference) || [];
    values.push(link.updatedAt, link.createdAt);
    interactions.set(link.candidateReference, values);
  }
  for (const draft of drafts) {
    const values = interactions.get(draft.candidateReference) || [];
    values.push(draft.updatedAt, draft.createdAt);
    interactions.set(draft.candidateReference, values);
  }
  const expiredCandidateRefs = new Set(candidates.filter(item => {
    const lastInteraction = latestTimestamp(item.updatedAt, item.capturedAt, interactions.get(item.reference) || []);
    return isExpired(lastInteraction, candidateDays, now);
  }).map(item => item.reference));
  const expiredSeenRefs = new Set(seenReferences.filter(item => isExpired(item.lastSeen, seenDays, now)).map(item => item.reference));
  return {
    candidateRefs: [...expiredCandidateRefs],
    seenRefs: [...expiredSeenRefs].filter(ref => !expiredCandidateRefs.has(ref)),
    linkIds: links.filter(link => expiredCandidateRefs.has(link.candidateReference)).map(link => link.id),
    draftIds: drafts.filter(draft => expiredCandidateRefs.has(draft.candidateReference)).map(draft => draft.id)
  };
}
