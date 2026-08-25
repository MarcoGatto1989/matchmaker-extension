import { makeId } from '../shared/ids.js';
import { uniqueStrings } from '../shared/text.js';

export const DEFAULT_WEIGHTS = Object.freeze({
  role: 25,
  skills: 25,
  location: 20,
  experience: 15,
  availability: 10,
  languagesMobility: 5
});

export function normalizeProject(input = {}) {
  return {
    id: input.id || makeId('project'),
    name: String(input.name || '').trim(),
    clientName: String(input.clientName || '').trim(),
    status: ['active', 'paused', 'archived'].includes(input.status) ? input.status : 'active',
    targetRoles: uniqueStrings(input.targetRoles || []),
    mustHaveSkills: uniqueStrings(input.mustHaveSkills || []),
    preferredSkills: uniqueStrings(input.preferredSkills || []),
    minimumExperience: Number.isFinite(Number(input.minimumExperience)) ? Number(input.minimumExperience) : null,
    experienceHard: Boolean(input.experienceHard),
    targetLocations: uniqueStrings(input.targetLocations || []),
    maxRadiusKm: Number.isFinite(Number(input.maxRadiusKm)) ? Number(input.maxRadiusKm) : null,
    workTimes: uniqueStrings(input.workTimes || []),
    requiredLanguages: uniqueStrings(input.requiredLanguages || []),
    languageHard: Boolean(input.languageHard),
    recruiterNotes: String(input.recruiterNotes || '').trim(),
    weights: { ...DEFAULT_WEIGHTS, ...(input.weights || {}) },
    outreach: {
      senderName: String(input.outreach?.senderName || '').trim(),
      discloseClient: Boolean(input.outreach?.discloseClient),
      closing: String(input.outreach?.closing || 'Freundliche Grüße').trim()
    },
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
