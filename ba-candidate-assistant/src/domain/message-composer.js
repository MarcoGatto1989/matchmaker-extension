function first(values = []) {
  return Array.isArray(values) ? values.find(Boolean) : null;
}

export function composeMessage(candidate, project) {
  const role = first(candidate.desiredRoles) || first(project.targetRoles) || 'Ihrem beruflichen Profil';
  const visibleSkill = first(candidate.skills);
  const experience = candidate.experienceYears != null ? `${candidate.experienceYears} Jahre Berufserfahrung` : null;
  const evidence = visibleSkill ? `Ihre Erfahrung mit ${visibleSkill}` : experience ? `Ihre ${experience}` : `Ihre Erfahrung im Bereich ${role}`;
  const mandate = project.outreach?.discloseClient && project.clientName
    ? `eine Position bei ${project.clientName}`
    : `eine Position aus einem aktuellen Mandat`;
  const sender = project.outreach?.senderName ? `\n${project.outreach.senderName}` : '';
  const closing = project.outreach?.closing || 'Freundliche Grüße';

  return [
    'Guten Tag,',
    '',
    `Ihr Profil in der Bewerberbörse ist mir aufgefallen. ${evidence} passt gut zu ${mandate}, die ich aktuell besetze.`,
    '',
    'Wenn ein unverbindlicher Austausch für Sie grundsätzlich interessant ist, sende ich Ihnen gern die konkreten Rahmendaten und weitere Informationen zur Position.',
    '',
    closing + sender
  ].join('\n');
}
