import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCandidateToProject, rankProjects } from '../src/domain/match-engine.js';
import { normalizeProject } from '../src/domain/project.js';

const candidate = {
  desiredRoles:['Lohn- und Gehaltsbuchhalter/in'], location:'Rostock', radiusKm:30,
  experienceYears:8, skills:['Lohn- und Gehaltsbuchhaltung, -abrechnung','DATEV Lohn und Gehalt'],
  workTimes:['Vollzeit','Teilzeit'], languages:['Deutsch – Verhandlungssicher'], mobility:['Fahrerlaubnis B']
};

test('deterministic matching scores a fitting payroll project strongly and explains it', () => {
  const project = normalizeProject({ name:'Lohn Rostock', targetRoles:['Lohn- und Gehaltsbuchhalter/in'], mustHaveSkills:['DATEV'], preferredSkills:['Lohn- und Gehaltsbuchhaltung'], targetLocations:['Rostock'], minimumExperience:3, workTimes:['Vollzeit'], requiredLanguages:['Deutsch'] });
  const match = matchCandidateToProject(candidate, project);
  assert.ok(match.score >= 85, JSON.stringify(match));
  assert.equal(match.classification, 'strong');
  assert.ok(match.positives.length >= 3);
  assert.equal(match.hardFailures.length, 0);
  assert.ok(match.confidence >= 80);
});

test('unknown candidate data lowers confidence rather than being scored as a negative fact', () => {
  const project = normalizeProject({ name:'Steuer', targetRoles:['Steuerfachangestellte/r'], mustHaveSkills:['DATEV'], targetLocations:['Köln'], minimumExperience:3 });
  const match = matchCandidateToProject({ desiredRoles:[],skills:[],location:null,experienceYears:null,workTimes:[],languages:[],mobility:[] }, project);
  assert.equal(match.score, 0);
  assert.equal(match.confidence, 0);
  assert.ok(match.unknown.length >= 3);
  assert.equal(match.hardFailures.length, 0);
});

test('known hard experience failure produces not_qualified', () => {
  const project = normalizeProject({ name:'Senior', minimumExperience:10, experienceHard:true });
  const match = matchCandidateToProject({ ...candidate, experienceYears:4 }, project);
  assert.equal(match.classification, 'not_qualified');
  assert.ok(match.hardFailures.some(value => /Mindestberufserfahrung/.test(value)));
});

test('rankProjects returns highest matching active project first and ignores archived projects', () => {
  const best = normalizeProject({ id:'best', name:'Rostock Lohn', targetRoles:['Lohn- und Gehaltsbuchhalter/in'], targetLocations:['Rostock'] });
  const weak = normalizeProject({ id:'weak', name:'Berlin Sales', targetRoles:['Vertriebsleiter/in'], targetLocations:['Berlin'] });
  const archived = normalizeProject({ id:'arch', name:'Archiv', status:'archived', targetRoles:['Lohn- und Gehaltsbuchhalter/in'] });
  const ranked = rankProjects(candidate,[weak,archived,best]);
  assert.equal(ranked[0].project.id,'best');
  assert.equal(ranked.some(item=>item.project.id==='arch'),false);
});

test('normalizers keep absent numeric evidence unknown instead of coercing null to zero', async () => {
  const { normalizeCandidateSnapshot } = await import('../src/domain/candidate.js');
  const normalizedCandidate = normalizeCandidateSnapshot({ radiusKm:null, experienceYears:null });
  const normalizedProject = normalizeProject({ name:'Null-Werte', minimumExperience:null, maxRadiusKm:null });
  assert.equal(normalizedCandidate.radiusKm, null);
  assert.equal(normalizedCandidate.experienceYears, null);
  assert.equal(normalizedProject.minimumExperience, null);
  assert.equal(normalizedProject.maxRadiusKm, null);
});
