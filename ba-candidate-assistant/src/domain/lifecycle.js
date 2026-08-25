const transitions = Object.freeze({
  new: new Set(['reviewed', 'skipped', 'not_relevant']),
  reviewed: new Set(['project_linked', 'skipped', 'not_relevant']),
  project_linked: new Set(['message_prepared', 'contacted', 'archived']),
  message_prepared: new Set(['contacted', 'project_linked', 'archived']),
  contacted: new Set(['archived']),
  skipped: new Set(['reviewed']),
  not_relevant: new Set(['reviewed']),
  archived: new Set([])
});

export function canTransition(from, to) {
  return Boolean(transitions[from]?.has(to));
}

export function transitionState(from, to) {
  if (from === to) return to;
  if (!canTransition(from, to)) throw new Error(`Ungültiger Statuswechsel: ${from} → ${to}`);
  return to;
}
