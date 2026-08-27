export function mergeSeenReference(current, { reference, outcome, reasonCode, now = new Date().toISOString() } = {}) {
  if (!reference) throw new Error('BA-Referenznummer fehlt.');
  const hasOutcome = outcome !== undefined && outcome !== null && outcome !== '';
  const hasReason = Object.prototype.hasOwnProperty.call(arguments[1] || {}, 'reasonCode');
  return {
    reference,
    firstSeen: current?.firstSeen || now,
    lastSeen: now,
    outcome: hasOutcome ? outcome : current?.outcome || 'unreviewed',
    reasonCode: hasReason ? reasonCode : current?.reasonCode ?? null
  };
}
