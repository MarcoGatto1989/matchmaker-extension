export function normalizeBaReference(value = '') {
  const match = String(value).toUpperCase().match(/\b(?:\d{3,}-)+\d{2,}-B\b|\b\d{3,}-B\b/);
  return match ? match[0] : null;
}

export function makeId(prefix = 'id') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
}
