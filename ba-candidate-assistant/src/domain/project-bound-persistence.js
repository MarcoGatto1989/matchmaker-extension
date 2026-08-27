export function orphanedCandidateReferencesAfterProjectRemoval(links = [], projectId) {
  const removing = links.filter(link => link.projectId === projectId);
  const remaining = links.filter(link => link.projectId !== projectId);
  const remainingRefs = new Set(remaining.map(link => link.candidateReference));
  return [...new Set(removing.map(link => link.candidateReference))].filter(reference => !remainingRefs.has(reference));
}
