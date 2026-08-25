export const BACKUP_VERSION = 1;

export function makeBackup(data = {}) {
  return {
    product: 'BA Kandidaten',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      projects: data.projects || [],
      candidates: data.candidates || [],
      seenReferences: data.seenReferences || [],
      links: data.links || [],
      drafts: data.drafts || [],
      settings: data.settings || {}
    }
  };
}

export function parseBackup(value) {
  const backup = typeof value === 'string' ? JSON.parse(value) : value;
  if (!backup || backup.product !== 'BA Kandidaten' || backup.version !== BACKUP_VERSION || !backup.data) {
    throw new Error('Ungültiges BA-Kandidaten-Backup.');
  }
  return backup.data;
}
