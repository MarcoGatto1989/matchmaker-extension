const DB_NAME = 'ba-kandidaten-v1';
const DB_VERSION = 1;
const STORES = Object.freeze({
  projects: 'projects',
  candidates: 'candidates',
  seenReferences: 'seenReferences',
  links: 'links',
  drafts: 'drafts',
  settings: 'settings'
});

let dbPromise;

export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.projects)) db.createObjectStore(STORES.projects, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.candidates)) db.createObjectStore(STORES.candidates, { keyPath: 'reference' });
      if (!db.objectStoreNames.contains(STORES.seenReferences)) db.createObjectStore(STORES.seenReferences, { keyPath: 'reference' });
      if (!db.objectStoreNames.contains(STORES.links)) {
        const store = db.createObjectStore(STORES.links, { keyPath: 'id' });
        store.createIndex('candidateReference', 'candidateReference', { unique: false });
        store.createIndex('projectId', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.drafts)) {
        const store = db.createObjectStore(STORES.drafts, { keyPath: 'id' });
        store.createIndex('candidateReference', 'candidateReference', { unique: false });
        store.createIndex('projectId', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB konnte nicht geöffnet werden.'));
    request.onblocked = () => reject(new Error('IndexedDB ist durch eine andere BA-Kandidaten-Instanz blockiert.'));
  });
  return dbPromise;
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB-Anfrage fehlgeschlagen.'));
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDatabase();
  return db.transaction(name, mode).objectStore(name);
}

export async function getAll(name) {
  return requestAsPromise((await store(name)).getAll());
}

export async function getOne(name, key) {
  return requestAsPromise((await store(name)).get(key));
}

export async function putOne(name, value) {
  return requestAsPromise((await store(name, 'readwrite')).put(value));
}

export async function deleteOne(name, key) {
  return requestAsPromise((await store(name, 'readwrite')).delete(key));
}

export async function clearStore(name) {
  return requestAsPromise((await store(name, 'readwrite')).clear());
}

export async function getByIndex(name, indexName, key) {
  const db = await openDatabase();
  const index = db.transaction(name, 'readonly').objectStore(name).index(indexName);
  return requestAsPromise(index.getAll(key));
}

export { STORES };
