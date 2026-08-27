export function normalizeText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß+/#.-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function uniqueStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    const key = normalizeText(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

export function tokens(value = '') {
  return normalizeText(value).split(' ').filter(token => token.length > 1);
}

export function tokenSimilarity(a = '', b = '') {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return (2 * intersection) / (left.size + right.size);
}

export function containsNormalized(haystack = '', needle = '') {
  const h = normalizeText(haystack);
  const n = normalizeText(needle);
  return Boolean(n && h.includes(n));
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}
