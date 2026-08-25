import { containsNormalized, normalizeText, tokenSimilarity } from '../shared/text.js';
import { DEFAULT_WEIGHTS } from './project.js';

function bestSimilarity(value, choices = []) {
  return choices.reduce((best, choice) => Math.max(best, tokenSimilarity(value, choice), containsNormalized(value, choice) || containsNormalized(choice, value) ? 1 : 0), 0);
}

function listCoverage(required = [], actual = []) {
  if (!required.length) return null;
  if (!actual.length) return null;
  const haystack = actual.map(normalizeText);
  let hits = 0;
  for (const item of required) {
    const target = normalizeText(item);
    if (haystack.some(value => value.includes(target) || target.includes(value))) hits += 1;
  }
  return { score: hits / required.length, hits, total: required.length };
}

function dimension(score, weight, label, positive, concern) {
  return { score, weight, label, positive, concern, known: score != null };
}

export function matchCandidateToProject(candidate, project) {
  const weights = { ...DEFAULT_WEIGHTS, ...(project.weights || {}) };
  const positives = [];
  const concerns = [];
  const unknown = [];
  const hardFailures = [];

  let roleScore = null;
  if (candidate.desiredRoles?.length && project.targetRoles?.length) {
    roleScore = Math.max(...candidate.desiredRoles.map(role => bestSimilarity(role, project.targetRoles)));
    if (roleScore >= 0.7) positives.push('Gesuchte Tätigkeit passt sehr gut zum Projekt.');
    else if (roleScore < 0.35) concerns.push('Gesuchte Tätigkeit passt nur schwach zum Projekttitel.');
  } else unknown.push('Tätigkeitsabgleich unvollständig');

  let skillsScore = null;
  const must = listCoverage(project.mustHaveSkills || [], candidate.skills || []);
  const preferred = listCoverage(project.preferredSkills || [], candidate.skills || []);
  if (must || preferred) {
    const parts = [];
    if (must) parts.push({ value: must.score, weight: 0.7 });
    if (preferred) parts.push({ value: preferred.score, weight: must ? 0.3 : 1 });
    const total = parts.reduce((sum, part) => sum + part.weight, 0);
    skillsScore = parts.reduce((sum, part) => sum + part.value * part.weight, 0) / total;
    if (must?.hits) positives.push(`${must.hits}/${must.total} Muss-Kenntnisse im Profil gefunden.`);
    if (must && must.hits < must.total) concerns.push('Nicht alle Muss-Kenntnisse sind im sichtbaren BA-Profil belegt.');
  } else if ((project.mustHaveSkills?.length || project.preferredSkills?.length) && !candidate.skills?.length) {
    unknown.push('Kenntnisse im BA-Profil nicht auswertbar');
  }

  let locationScore = null;
  if (project.targetLocations?.length && candidate.location) {
    locationScore = bestSimilarity(candidate.location, project.targetLocations);
    if (locationScore >= 0.7) positives.push('Arbeitsort passt zum Projektstandort.');
    else concerns.push('Arbeitsort stimmt nicht direkt mit dem Projektstandort überein.');
    if (project.maxRadiusKm != null && candidate.radiusKm != null && candidate.radiusKm < project.maxRadiusKm && locationScore < 0.7) {
      concerns.push(`Angegebener Suchradius (${candidate.radiusKm} km) ist kleiner als der gewünschte Projekt-Radius.`);
    }
  } else if (project.targetLocations?.length) unknown.push('Standortabgleich unvollständig');

  let experienceScore = null;
  if (project.minimumExperience != null && candidate.experienceYears != null) {
    experienceScore = project.minimumExperience <= 0 ? 1 : Math.min(1, candidate.experienceYears / project.minimumExperience);
    if (candidate.experienceYears >= project.minimumExperience) positives.push('Berufserfahrung erfüllt die Projektanforderung.');
    else {
      concerns.push(`Berufserfahrung liegt unter ${project.minimumExperience} Jahren.`);
      if (project.experienceHard) hardFailures.push('Mindestberufserfahrung nicht erfüllt');
    }
  } else if (project.minimumExperience != null) unknown.push('Berufserfahrung nicht eindeutig bezifferbar');

  let availabilityScore = null;
  const requestedWorkTimes = project.workTimes || [];
  if (requestedWorkTimes.length) {
    if (candidate.workTimes?.length) {
      const coverage = listCoverage(requestedWorkTimes, candidate.workTimes);
      availabilityScore = coverage?.score ?? null;
      if (availabilityScore > 0) positives.push('Arbeitszeitmodell überschneidet sich mit dem Projekt.');
      else concerns.push('Arbeitszeitmodell passt nicht zum Projekt.');
    } else unknown.push('Arbeitszeitmodell nicht verfügbar');
  } else if (candidate.availability) {
    availabilityScore = 1;
  }

  let languagesMobilityScore = null;
  if (project.requiredLanguages?.length) {
    if (candidate.languages?.length) {
      const coverage = listCoverage(project.requiredLanguages, candidate.languages);
      languagesMobilityScore = coverage?.score ?? null;
      if (coverage?.hits === coverage?.total) positives.push('Sprachanforderungen sind im Profil belegt.');
      else {
        concerns.push('Nicht alle Sprachanforderungen sind im Profil belegt.');
        if (project.languageHard) hardFailures.push('Sprachanforderung nicht erfüllt');
      }
    } else unknown.push('Sprachkenntnisse nicht auswertbar');
  } else if (candidate.languages?.length || candidate.mobility?.length) {
    languagesMobilityScore = 1;
  }

  const dimensions = {
    role: dimension(roleScore, weights.role, 'Tätigkeit', 'Tätigkeit passt', 'Tätigkeit weicht ab'),
    skills: dimension(skillsScore, weights.skills, 'Kenntnisse', 'Kenntnisse passen', 'Kenntnisse fehlen teilweise'),
    location: dimension(locationScore, weights.location, 'Standort', 'Standort passt', 'Standort weicht ab'),
    experience: dimension(experienceScore, weights.experience, 'Erfahrung', 'Erfahrung passt', 'Erfahrung zu gering'),
    availability: dimension(availabilityScore, weights.availability, 'Verfügbarkeit', 'Arbeitszeit passt', 'Arbeitszeit weicht ab'),
    languagesMobility: dimension(languagesMobilityScore, weights.languagesMobility, 'Sprache/Mobilität', 'Anforderungen passen', 'Anforderungen weichen ab')
  };

  const known = Object.values(dimensions).filter(item => item.known && item.weight > 0);
  const knownWeight = known.reduce((sum, item) => sum + item.weight, 0);
  const weighted = known.reduce((sum, item) => sum + item.score * item.weight, 0);
  const score = knownWeight ? Math.round((weighted / knownWeight) * 100) : 0;
  const confidence = Math.round((knownWeight / Object.values(weights).reduce((sum, weight) => sum + Number(weight || 0), 0)) * 100);

  let classification = score >= 85 ? 'strong' : score >= 70 ? 'good' : score >= 55 ? 'possible' : 'weak';
  if (hardFailures.length) classification = 'not_qualified';

  return { score, confidence, classification, positives, concerns, unknown, hardFailures, dimensions };
}

export function rankProjects(candidate, projects = []) {
  return projects
    .filter(project => project.status === 'active')
    .map(project => ({ project, match: matchCandidateToProject(candidate, project) }))
    .sort((a, b) => b.match.score - a.match.score || b.match.confidence - a.match.confidence);
}
