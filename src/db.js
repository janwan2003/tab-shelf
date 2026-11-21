// Tabhaven storage layer: IndexedDB with strict-durability transactions.
// Shared by the service worker and the extension pages.
//
// Stores:
//   groups        {id, title, createdAt, updatedAt, starred, locked, tabs:[{url,title,pinned}]}
//   snapshots     {id(auto), at, reason, groupCount, tabCount}   (metadata only, cheap to list)
//   snapshotData  {id, groups}                                    (full copy of the shelf)
//   meta          {key, value}                                    (settings, backup status)

export const DB_NAME = 'tabhaven';
const DB_VERSION = 1;
export const MAX_SNAPSHOTS = 30;
// Minor edits (renaming, removing one tab) snapshot at most this often.
const MINOR_SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000;

export const DEFAULT_SETTINGS = {
  keepPinned: true,        // leave pinned tabs open when saving a window
  removeOnRestore: true,   // restoring a tab or group takes it off the shelf (locked groups never)
  backups: true,           // write backup files to Downloads/Tabhaven/
  dailyBackups: true,      // also keep 7 rotating daily copies
  skipDuplicates: false,   // skip tabs whose URL is already on the shelf
};

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('snapshotData')) db.createObjectStore('snapshotData', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => console.warn('Tabhaven: database upgrade blocked by another open page');
  });
  return dbPromise;
}

export function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Run fn(stores) inside one transaction. Resolves with fn's result only after the
// transaction has committed (and, for writes, been flushed to disk: durability 'strict').
// Inside fn only await IndexedDB requests (reqP), never other promises.
export async function tx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    const stores = {};
    for (const n of storeNames) stores[n] = t.objectStore(n);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    Promise.resolve()
      .then(() => fn(stores, t))
      .then((r) => { result = r; })
      .catch((e) => { try { t.abort(); } catch {} reject(e); });
  });
}

export function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function countTabs(groups) {
  let n = 0;
  for (const g of groups) n += g.tabs.length;
  return n;
}

export function sortGroups(groups) {
  return groups.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || b.createdAt - a.createdAt);
}

export async function getAllGroups() {
  const groups = await tx(['groups'], 'readonly', (s) => reqP(s.groups.getAll()));
  return sortGroups(groups);
}

export async function getGroup(id) {
  return tx(['groups'], 'readonly', (s) => reqP(s.groups.get(id)));
}

// Write a snapshot of the current shelf inside an open transaction.
async function snapshotInTx(s, reason, minor) {
  if (minor) {
    const last = await reqP(s.snapshots.openCursor(null, 'prev'));
    if (last && Date.now() - last.value.at < MINOR_SNAPSHOT_INTERVAL_MS) return null;
  }
  const groups = await reqP(s.groups.getAll());
  if (groups.length === 0) return null;
  const id = await reqP(s.snapshots.add({ at: Date.now(), reason, groupCount: groups.length, tabCount: countTabs(groups) }));
  await reqP(s.snapshotData.put({ id, groups }));
  // Prune the oldest snapshots.
  const keys = await reqP(s.snapshots.getAllKeys());
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SNAPSHOTS))) {
    await reqP(s.snapshots.delete(k));
    await reqP(s.snapshotData.delete(k));
  }
  return id;
}

const ALL = ['groups', 'snapshots', 'snapshotData', 'meta'];

// Generic mutation: optional snapshot first, then fn(stores), all atomically.
export async function mutate({ snapshot, minor = false } = {}, fn) {
  const result = await tx(ALL, 'readwrite', async (s) => {
    if (snapshot) await snapshotInTx(s, snapshot, minor);
    const r = await fn(s);
    await reqP(s.meta.put({ key: 'dirty', value: Date.now() }));
    return r;
  });
  notifyChanged();
  return result;
}

export function normalizeTab(t) {
  const tab = { url: String(t.url || ''), title: String(t.title || t.url || '') };
  if (t.pinned) tab.pinned = true;
  return tab;
}

export function makeGroup({ id, title = '', tabs, createdAt, starred, locked }) {
  const now = Date.now();
  return {
    id: id || newId(),
    title: String(title || ''),
    createdAt: Number(createdAt) || now,
    updatedAt: now,
    starred: !!starred,
    locked: !!locked,
    tabs: tabs.map(normalizeTab).filter((t) => t.url),
  };
}

// Add groups durably, then read them back to prove the write landed.
export async function addGroups(groups, { snapshot } = {}) {
  const made = groups.filter((g) => g.tabs.length).map(makeGroup);
  await mutate({ snapshot }, async (s) => {
    for (const g of made) await reqP(s.groups.add(g));
  });
  const verified = await tx(['groups'], 'readonly', async (s) => {
    for (const g of made) {
      const back = await reqP(s.groups.get(g.id));
      if (!back || back.tabs.length !== g.tabs.length) return false;
    }
    return true;
  });
  if (!verified) throw new Error('Tabhaven could not verify the save; your tabs were left open.');
  return made;
}

export async function updateGroup(id, patchFn, { snapshot = 'edit', minor = true } = {}) {
  return mutate({ snapshot, minor }, async (s) => {
    const g = await reqP(s.groups.get(id));
    if (!g) return null;
    // patchFn edits the draft in place (or returns a replacement).
    const draft = structuredClone(g);
    const next = patchFn(draft) || draft;
    next.updatedAt = Date.now();
    if (next.tabs.length === 0) await reqP(s.groups.delete(id));
    else await reqP(s.groups.put(next));
    return next;
  });
}

export async function putGroup(group, { snapshot = null } = {}) {
  return mutate({ snapshot }, (s) => reqP(s.groups.put(group)));
}

export async function deleteGroup(id, { reason = 'delete group' } = {}) {
  return mutate({ snapshot: reason }, async (s) => {
    const g = await reqP(s.groups.get(id));
    await reqP(s.groups.delete(id));
    return g;
  });
}

export async function deleteGroups(ids, { reason = 'delete groups' } = {}) {
  return mutate({ snapshot: reason }, async (s) => {
    for (const id of ids) await reqP(s.groups.delete(id));
  });
}

export async function replaceAll(groups, { reason = 'restore version' } = {}) {
  return mutate({ snapshot: reason }, async (s) => {
    await reqP(s.groups.clear());
    for (const g of groups) await reqP(s.groups.put(g));
  });
}

export async function takeSnapshot(reason) {
  return tx(ALL, 'readwrite', (s) => snapshotInTx(s, reason, false));
}

export async function listSnapshots() {
  const list = await tx(['snapshots'], 'readonly', (s) => reqP(s.snapshots.getAll()));
  return list.reverse();
}

export async function getSnapshotGroups(id) {
  const rec = await tx(['snapshotData'], 'readonly', (s) => reqP(s.snapshotData.get(id)));
  return rec ? rec.groups : null;
}

export async function getMeta(key, fallback = null) {
  const rec = await tx(['meta'], 'readonly', (s) => reqP(s.meta.get(key)));
  return rec ? rec.value : fallback;
}

export async function setMeta(key, value) {
  return tx(['meta'], 'readwrite', (s) => reqP(s.meta.put({ key, value })));
}

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await getMeta('settings', {})) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await setMeta('settings', next);
  notifyChanged('settings');
  return next;
}

// ---- change notification -------------------------------------------------
// Pages listen on a BroadcastChannel; the service worker is woken with a runtime message
// so it can schedule a backup.
let channel = null;
const localListeners = new Set();

export function onChanged(fn) {
  localListeners.add(fn);
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('tabhaven');
    channel.onmessage = (e) => localListeners.forEach((l) => l(e.data));
  }
}

export function notifyChanged(what = 'groups') {
  const msg = { type: 'changed', what };
  if (typeof BroadcastChannel !== 'undefined') {
    const c = new BroadcastChannel('tabhaven');
    c.postMessage(msg);
    c.close(); // delivered to every other channel object, including this page's listener
  }
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage && !globalThis.__tabhavenIsWorker) {
      chrome.runtime.sendMessage(msg).catch(() => {});
    }
  } catch {}
}
