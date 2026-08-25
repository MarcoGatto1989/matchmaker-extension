export function markProjectDraftsSent(drafts = [], projectId, now = new Date().toISOString()) {
  return drafts.map(draft => draft.projectId === projectId
    ? { ...draft, status:'marked_sent', updatedAt:now }
    : draft);
}
