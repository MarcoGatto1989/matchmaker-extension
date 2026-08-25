import { normalizeBaReference } from '../shared/ids.js';
import { uniqueStrings } from '../shared/text.js';

function optionalNumber(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeCandidateSnapshot(input = {}) {
  return {
    reference: normalizeBaReference(input.reference || ''),
    publication: String(input.publication || '').trim() || null,
    desiredRoles: uniqueStrings(input.desiredRoles || []),
    location: input.location ? String(input.location).trim() : null,
    postalCode: input.postalCode ? String(input.postalCode).trim() : null,
    radiusKm: optionalNumber(input.radiusKm),
    availability: input.availability ? String(input.availability).trim() : null,
    workTimes: uniqueStrings(input.workTimes || []),
    experienceYears: optionalNumber(input.experienceYears),
    experience: Array.isArray(input.experience) ? input.experience : [],
    education: Array.isArray(input.education) ? input.education : [],
    skills: uniqueStrings(input.skills || []),
    languages: uniqueStrings(input.languages || []),
    competencies: uniqueStrings(input.competencies || []),
    mobility: uniqueStrings(input.mobility || []),
    source: input.source || 'ba_profile',
    adapterVersion: input.adapterVersion || 'unknown',
    confidence: Number.isFinite(Number(input.confidence)) ? Math.max(0, Math.min(1, Number(input.confidence))) : 0,
    missingFields: uniqueStrings(input.missingFields || []),
    capturedAt: input.capturedAt || new Date().toISOString()
  };
}
