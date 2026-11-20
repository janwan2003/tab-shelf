// Tabhaven service worker: saving tabs, context menus, shortcuts and backup scheduling.
globalThis.__tabhavenIsWorker = true;
import { addGroups, getSettings, getAllGroups } from './db.js';
import { writeBackup, backupNeeded } from './backup.js';

const SHELF_URL = chrome.runtime.getURL('shelf.html');
const BACKUP_SOON = 'backup-soon';
const BACKUP_PERIODIC = 'backup-periodic';

function isOwnPage(url) {
  return typeof url === 'string' && url.startsWith(chrome.runtime.getURL(''));
}

function isWorthSaving(tab) {
  const url = tab.url || tab.pendingUrl || '';
  if (!url || isOwnPage(url)) return false;
  return !/^(chrome|edge|brave):\/\/newtab\/?$|^about:(blank|newtab)$|^chrome-search:/i.test(url);
}

// Open (or focus) the shelf in the given window.
export async function openShelf(windowId) {
  const existing = await chrome.tabs.query({ url: SHELF_URL + '*', ...(windowId ? { windowId } : {}) });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (windowId) await chrome.windows.update(windowId, { focused: true }).catch(() => {});
    return existing[0];
  }
  return chrome.tabs.create({ url: SHELF_URL, ...(windowId ? { windowId } : {}), index: 0, active: true });
}

// Save tabs to the shelf, then close them. Tabs are closed only after the save has been
// committed to disk and read back; on any failure they stay open.
// scope: 'window' | 'all' | 'tab' | 'tabs'
export async function shelve({ scope = 'window', windowId, tabIds } = {}) {
  const settings = await getSettings();
  let tabs;
  if (scope === 'all') tabs = await chrome.tabs.query({});
  else if (scope === 'tab' || scope === 'tabs') {
    tabs = tabIds?.length
      ? (await Promise.all(tabIds.map((id) => chrome.tabs.get(id).catch(() => null)))).filter(Boolean)
      : await chrome.tabs.query({ active: true, ...(windowId ? { windowId } : { lastFocusedWindow: true }) });
  } else {
    const wid = windowId ?? (await chrome.windows.getLastFocused()).id;
    tabs = await chrome.tabs.query({ windowId: wid });
  }
  tabs = tabs.filter(isWorthSaving);
  if (scope !== 'tab' && scope !== 'tabs' && settings.keepPinned) tabs = tabs.filter((t) => !t.pinned);
  if (settings.skipDuplicates) {
    const known = new Set();
    for (const g of await getAllGroups()) for (const t of g.tabs) known.add(t.url);
    const dupes = tabs.filter((t) => known.has(t.url || t.pendingUrl));
    tabs = tabs.filter((t) => !known.has(t.url || t.pendingUrl));
    if (dupes.length) await chrome.tabs.remove(dupes.map((t) => t.id)).catch(() => {});
  }
  if (!tabs.length) return { ok: false, reason: 'No tabs to save in this window.' };

  // One group per window, in window order.
  const byWindow = new Map();
  for (const t of tabs.sort((a, b) => a.windowId - b.windowId || a.index - b.index)) {
    if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
    byWindow.get(t.windowId).push(t);
  }
  const groups = [...byWindow.values()].map((ts) => ({
    tabs: ts.map((t) => ({ url: t.url || t.pendingUrl, title: t.title, pinned: t.pinned })),
  }));
  let saved;
  try {
    saved = await addGroups(groups);
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
  scheduleBackup();

  // Keep every affected window alive: put the shelf in it before closing its tabs.
  const focusWindow = windowId ?? tabs[0].windowId;
  for (const [wid, ts] of byWindow) {
    const remaining = (await chrome.tabs.query({ windowId: wid })).filter((t) => !ts.some((x) => x.id === t.id));
    if (wid === focusWindow) await openShelf(wid);
    else if (!remaining.length) await chrome.tabs.create({ windowId: wid, url: SHELF_URL });
  }
  await chrome.tabs.remove(tabs.map((t) => t.id)).catch(() => {});
  return { ok: true, count: tabs.length, groups: saved.map((g) => g.id) };
}

function scheduleBackup() {
  chrome.alarms.create(BACKUP_SOON, { delayInMinutes: 0.5 });
}

async function setup() {
  await chrome.contextMenus.removeAll();
  const menus = [
    { id: 'shelve-all', title: 'Save tabs from all windows', contexts: ['action'] },
    { id: 'open-shelf', title: 'Open Tabhaven', contexts: ['action'] },
    { id: 'shelve-tab', title: 'Save this tab to Tabhaven', contexts: ['page'] },
    { id: 'shelve-window', title: 'Save all tabs in this window to Tabhaven', contexts: ['page'] },
  ];
  for (const m of menus) chrome.contextMenus.create(m);
  const periodic = await chrome.alarms.get(BACKUP_PERIODIC);
  if (!periodic) chrome.alarms.create(BACKUP_PERIODIC, { periodInMinutes: 60 });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await setup();
  if (reason === 'install') openShelf();
  else if (await backupNeeded()) scheduleBackup();
});

chrome.runtime.onStartup.addListener(async () => {
  await setup();
  if (await backupNeeded()) scheduleBackup();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'shelve-all') shelve({ scope: 'all', windowId: tab?.windowId });
  else if (info.menuItemId === 'open-shelf') openShelf(tab?.windowId);
  else if (info.menuItemId === 'shelve-tab') shelve({ scope: 'tabs', tabIds: [tab.id], windowId: tab.windowId });
  else if (info.menuItemId === 'shelve-window') shelve({ scope: 'window', windowId: tab?.windowId });
});

chrome.commands.onCommand.addListener(async (command) => {
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (command === 'shelve-window') shelve({ scope: 'window', windowId: win?.id });
  else if (command === 'open-shelf') openShelf(win?.id);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === BACKUP_SOON) await writeBackup();
  else if (alarm.name === BACKUP_PERIODIC && (await backupNeeded())) await writeBackup();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'changed') {
    scheduleBackup();
    return;
  }
  const handlers = {
    shelve: () => shelve(msg),
    backupNow: () => writeBackup({ force: true }),
    openShelf: () => openShelf(msg.windowId ?? sender.tab?.windowId),
  };
  const h = handlers[msg.cmd];
  if (!h) return;
  h().then(sendResponse, (e) => sendResponse({ ok: false, reason: String(e?.message || e) }));
  return true;
});
