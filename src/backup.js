// Automatic backup files in Downloads/Tabhaven/. Runs in the service worker.
import { getAllGroups, getMeta, setMeta, getSettings, countTabs } from './db.js';
import { toJSON, toHTML } from './formats.js';

export const BACKUP_DIR = 'Tabhaven';
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function waitForDownload(id) {
  return new Promise((resolve) => {
    const done = (state, error) => {
      chrome.downloads.onChanged.removeListener(listener);
      clearTimeout(timer);
      resolve({ state, error });
    };
    const listener = (delta) => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') done('complete');
      else if (delta.state?.current === 'interrupted') done('interrupted', delta.error?.current);
    };
    chrome.downloads.onChanged.addListener(listener);
    const timer = setTimeout(() => done('timeout'), 60000);
    // It may already be finished.
    chrome.downloads.search({ id }).then(([item]) => {
      if (item?.state === 'complete') done('complete');
      else if (item?.state === 'interrupted') done('interrupted', item.error);
    });
  });
}

async function writeFile(filename, text, mime) {
  const url = `data:${mime};charset=utf-8;base64,${toBase64(text)}`;
  const id = await chrome.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false });
  const r = await waitForDownload(id);
  if (r.state !== 'complete') throw new Error(`Backup ${filename} failed: ${r.error || r.state}`);
  const [item] = await chrome.downloads.search({ id });
  // Remove the entry from the downloads list; the file stays on disk.
  await chrome.downloads.erase({ id }).catch(() => {});
  return item?.filename || filename;
}

let running = null;

// Write the backup files. Returns the status object stored in meta 'lastBackup'.
export async function writeBackup({ force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const settings = await getSettings();
    if (!settings.backups && !force) return { skipped: 'disabled' };
    const dirtyAt = await getMeta('dirty', 0);
    const groups = await getAllGroups();
    const now = Date.now();
    const quiet = !!chrome.downloads.setUiOptions;
    if (quiet) await chrome.downloads.setUiOptions({ enabled: false }).catch(() => {});
    try {
      const json = toJSON(groups, now);
      const path = await writeFile(`${BACKUP_DIR}/tabhaven-backup-latest.json`, json, 'application/json');
      await writeFile(`${BACKUP_DIR}/tabhaven-backup-latest.html`, toHTML(groups, now), 'text/html');
      const today = new Date(now).toDateString();
      if (settings.dailyBackups && (await getMeta('lastDaily', '')) !== today) {
        await writeFile(`${BACKUP_DIR}/daily/tabhaven-backup-${WEEKDAYS[new Date(now).getDay()]}.json`, json, 'application/json');
        await setMeta('lastDaily', today);
      }
      const status = { ok: true, at: now, path, groups: groups.length, tabs: countTabs(groups), dirtyAt };
      await setMeta('lastBackup', status);
      return status;
    } catch (e) {
      const status = { ok: false, at: now, error: String(e?.message || e) };
      await setMeta('lastBackupError', status);
      return status;
    } finally {
      if (quiet) await chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});
    }
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

// True if the shelf changed since the last successful backup.
export async function backupNeeded() {
  const [dirty, last] = await Promise.all([getMeta('dirty', 0), getMeta('lastBackup', null)]);
  return !!dirty && (!last || !last.ok || (last.dirtyAt || 0) < dirty);
}
