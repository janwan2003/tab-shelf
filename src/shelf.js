import {
  getAllGroups, getSettings, setSettings, updateGroup, putGroup, deleteGroup, deleteGroups,
  addGroups, replaceAll, listSnapshots, getSnapshotGroups, getMeta, onChanged, countTabs,
} from './db.js';
import { parseImport, toJSON, toHTML, toText, toMarkdown, escapeHTML, formatDate } from './formats.js';

const PAGE = 300; // tabs rendered per group before "show more"
const $ = (sel) => document.querySelector(sel);
const state = { groups: [], settings: null, query: '', expanded: new Set() };

// ---- helpers ---------------------------------------------------------------
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

function host(url) {
  try {
    const u = new URL(url);
    return u.host || u.protocol.replace(':', '');
  } catch {
    return '';
  }
}

// Chrome serves cached site icons to extensions (the 'favicon' permission). Firefox has no such
// cache API, and fetching icons from the sites would be a network request per tab, so there each
// tab gets a letter tile instead.
const HAS_FAVICONS = (chrome.runtime.getManifest().permissions || []).includes('favicon');
function faviconHTML(url) {
  if (HAS_FAVICONS) {
    const src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=16`);
    return `<img src="${escapeHTML(src)}" alt="" loading="lazy">`;
  }
  const h = host(url).replace(/^www\./, '');
  let hue = 0;
  for (const c of h) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  return `<span class="fav" style="--hue:${hue}" aria-hidden="true">${escapeHTML((h[0] || '?').toUpperCase())}</span>`;
}

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return formatDate(ms);
}

let toastTimer;
function toast(text, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${escapeHTML(text)}</span>`;
  if (undo) {
    const b = document.createElement('button');
    b.textContent = 'Undo';
    b.onclick = async () => { el.hidden = true; await undo(); };
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), undo ? 8000 : 4000);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const findGroup = (id) => state.groups.find((g) => g.id === id);

// Remove tab i, but only if it is still the tab the user clicked (the shelf may have
// changed in another window since this page rendered).
function removeTabAt(i, url) {
  return (x) => {
    const k = x.tabs[i]?.url === url ? i : x.tabs.findIndex((t) => t.url === url);
    if (k >= 0) x.tabs.splice(k, 1);
  };
}

// ---- search ----------------------------------------------------------------
const hay = new WeakMap();
function haystack(t) {
  let h = hay.get(t);
  if (h === undefined) { h = `${t.title}\n${t.url}`.toLowerCase(); hay.set(t, h); }
  return h;
}

function filtered() {
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return state.groups.map((g) => ({ g, idx: null }));
  const out = [];
  for (const g of state.groups) {
    const titleHit = terms.every((t) => g.title.toLowerCase().includes(t));
    const idx = [];
    g.tabs.forEach((t, i) => { if (titleHit || terms.every((q) => haystack(t).includes(q))) idx.push(i); });
    if (idx.length) out.push({ g, idx });
  }
  return out;
}

// ---- render ----------------------------------------------------------------
function tabRow(g, t, i) {
  return `<li draggable="true" data-i="${i}">${faviconHTML(t.url)}<a class="tab" href="${escapeHTML(t.url)}" title="${escapeHTML(t.url)}">${escapeHTML(t.title || t.url)}</a><span class="host">${escapeHTML(host(t.url))}</span><button class="rm" data-act="rm-tab" title="Remove from shelf" aria-label="Remove ${escapeHTML(t.title || t.url)}">×</button></li>`;
}

function groupCard({ g, idx }) {
  const indices = idx || g.tabs.map((_, i) => i);
  const limit = state.expanded.has(g.id) || state.query ? indices.length : Math.min(PAGE, indices.length);
  const rows = [];
  for (let k = 0; k < limit; k++) rows.push(tabRow(g, g.tabs[indices[k]], indices[k]));
  const count = idx ? `${idx.length} of ${plural(g.tabs.length, 'tab')}` : plural(g.tabs.length, 'tab');
  return `<section class="group${g.starred ? ' starred' : ''}" data-id="${escapeHTML(g.id)}">
  <div class="ghead">
    <span class="gcount">${count}</span>
    <input class="gtitle" value="${escapeHTML(g.title)}" placeholder="Name this group" aria-label="Group name">
    <span class="gdate">${escapeHTML(formatDate(g.createdAt))}</span>
    <span class="gactions">
      <button data-act="restore" title="Open all tabs in this window">Restore all</button>
      <button data-act="restore-win" title="Open all tabs in a new window">New window</button>
      <button data-act="star" class="${g.starred ? 'on' : ''}" aria-pressed="${g.starred}" title="Keep this group at the top">★</button>
      <button data-act="lock" class="${g.locked ? 'on' : ''}" aria-pressed="${g.locked}" title="Locked groups stay on the shelf when restored and can't be deleted">${g.locked ? 'Locked' : 'Lock'}</button>
      <button data-act="del" class="del" ${g.locked ? 'disabled' : ''} title="Delete this group">Delete</button>
    </span>
  </div>
  <ul class="tabs">${rows.join('')}</ul>
  ${limit < indices.length ? `<div class="more"><button data-act="more">Show ${plural(indices.length - limit, 'more tab')}</button></div>` : ''}
</section>`;
}

function render() {
  const list = filtered();
  const total = countTabs(state.groups);
  $('#empty').hidden = state.groups.length > 0;
  $('#groups').hidden = state.groups.length === 0;
  if (state.query) {
    const hits = list.reduce((n, x) => n + x.idx.length, 0);
    $('#stats').textContent = `${hits.toLocaleString()} ${hits === 1 ? 'match' : 'matches'} of ${plural(total, 'tab')}`;
  } else {
    $('#stats').textContent = state.groups.length ? `${plural(total, 'tab')} in ${plural(state.groups.length, 'group')}` : '';
  }
  $('#groups').innerHTML = list.length || !state.query ? list.map(groupCard).join('') : '<p class="hint" style="padding:20px">No saved tab matches your search.</p>';
}

async function renderBackupStatus() {
  const el = $('#backup-status');
  const [last, err] = await Promise.all([getMeta('lastBackup', null), getMeta('lastBackupError', null)]);
  el.classList.remove('warn');
  if (!state.settings.backups) {
    el.classList.add('warn');
    el.innerHTML = 'Backup files are off. If this browser profile is lost, so are your tabs. <button data-act="enable-backups">Turn backups on</button>';
  } else if (err && (!last || err.at > last.at)) {
    el.classList.add('warn');
    el.innerHTML = `The last backup failed (${escapeHTML(err.error)}). <button data-act="backup-now">Try again</button>`;
  } else if (last) {
    el.innerHTML = `Backed up ${escapeHTML(ago(last.at))}: ${plural(last.tabs, 'tab')} in <code title="${escapeHTML(last.path)}">Downloads/Tabhaven/</code> <button data-act="backup-now">Back up now</button>`;
  } else if (state.groups.length) {
    el.innerHTML = 'No backup file yet; one is written within a minute of every change. <button data-act="backup-now">Back up now</button>';
  } else {
    el.textContent = '';
  }
}

let reloadTimer;
async function reload() {
  [state.groups, state.settings] = await Promise.all([getAllGroups(), getSettings()]);
  render();
  renderBackupStatus();
}
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reload, 60);
}

// ---- actions ---------------------------------------------------------------
// Opens the tabs. Returns null if the user cancelled, else the tabs the browser refused to open.
async function openTabs(tabs, { newWindow = false } = {}) {
  if (tabs.length > 50 && !confirm(`Open ${tabs.length} tabs?`)) return null;
  const failed = [];
  const add = (windowId, t) => chrome.tabs.create({ windowId, url: t.url, active: false, pinned: !!t.pinned }).catch(() => { failed.push(t); });
  if (newWindow) {
    try {
      await chrome.windows.create({ url: tabs.map((t) => t.url), focused: true });
    } catch {
      // Firefox refuses the whole window if one URL is privileged (about:config, file://...).
      // Open the rest one by one into a new window.
      const win = await chrome.windows.create({ focused: true });
      const blank = (win.tabs || []).map((t) => t.id);
      for (const t of tabs) await add(win.id, t);
      if (failed.length < tabs.length) await chrome.tabs.remove(blank).catch(() => {});
    }
  } else {
    const cur = await chrome.windows.getCurrent();
    for (const t of tabs) await add(cur.id, t);
  }
  return failed;
}

async function restoreGroup(g, newWindow) {
  const failed = await openTabs(g.tabs, { newWindow });
  if (!failed) return;
  const note = failed.length
    ? ` ${plural(failed.length, 'tab')} could not be opened (the browser blocks pages like about: and file: for extensions) and stayed on the shelf.`
    : '';
  if (state.settings.removeOnRestore && !g.locked) {
    if (failed.length) {
      const failedUrls = new Set(failed.map((t) => t.url));
      const opened = new Set(g.tabs.map((t) => t.url).filter((u) => !failedUrls.has(u)));
      await updateGroup(g.id, (x) => { x.tabs = x.tabs.filter((t) => !opened.has(t.url)); }, { snapshot: 'restore group', minor: false });
    } else {
      await deleteGroup(g.id, { reason: 'restore group' });
    }
    toast(`Restored ${plural(g.tabs.length - failed.length, 'tab')}.${note}`, () => putGroup(g));
  } else if (failed.length) {
    toast(`Restored ${plural(g.tabs.length - failed.length, 'tab')}.${note}`);
  }
}

async function openOne(g, i) {
  const t = g.tabs[i];
  try {
    await chrome.tabs.create({ url: t.url, active: false, pinned: !!t.pinned });
  } catch {
    toast('The browser does not let extensions open this page. Copy the link from the shelf instead.');
    return;
  }
  if (state.settings.removeOnRestore && !g.locked) {
    await updateGroup(g.id, removeTabAt(i, t.url), { snapshot: 'restore tab' });
    toast('Opened 1 tab', () => putGroup(g));
  }
}

async function onGroupsClick(e) {
  const sec = e.target.closest('.group');
  if (!sec) return;
  const g = findGroup(sec.dataset.id);
  if (!g) return;
  const link = e.target.closest('a.tab');
  if (link) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // browser opens it; keep it on the shelf
    e.preventDefault();
    return openOne(g, Number(link.closest('li').dataset.i));
  }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'rm-tab') {
    const i = Number(btn.closest('li').dataset.i);
    await updateGroup(g.id, removeTabAt(i, g.tabs[i].url), { snapshot: 'remove tab' });
    toast('Removed 1 tab', () => putGroup(g));
  } else if (act === 'restore') restoreGroup(g, false);
  else if (act === 'restore-win') restoreGroup(g, true);
  else if (act === 'star') updateGroup(g.id, (x) => { x.starred = !x.starred; });
  else if (act === 'lock') updateGroup(g.id, (x) => { x.locked = !x.locked; });
  else if (act === 'del') {
    await deleteGroup(g.id);
    toast(`Deleted ${plural(g.tabs.length, 'tab')}`, () => putGroup(g));
  } else if (act === 'more') {
    state.expanded.add(g.id);
    render();
  }
}

async function onTitleChange(e) {
  if (!e.target.classList.contains('gtitle')) return;
  const id = e.target.closest('.group').dataset.id;
  const title = e.target.value.trim();
  await updateGroup(id, (x) => { x.title = title; }, { snapshot: 'rename group' });
}

// ---- drag tabs between groups ---------------------------------------------
let drag = null;
function setupDrag(root) {
  root.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('li[data-i]');
    if (!li) return;
    drag = { from: li.closest('.group').dataset.id, i: Number(li.dataset.i) };
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    const t = findGroup(drag.from)?.tabs[drag.i];
    if (t) e.dataTransfer.setData('text/uri-list', t.url);
  });
  root.addEventListener('dragend', (e) => {
    e.target.closest?.('li')?.classList.remove('dragging');
    root.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    drag = null;
  });
  root.addEventListener('dragover', (e) => {
    const sec = e.target.closest('.group');
    if (!drag || !sec || sec.dataset.id === drag.from) return;
    e.preventDefault();
    root.querySelectorAll('.drop').forEach((x) => x !== sec && x.classList.remove('drop'));
    sec.classList.add('drop');
  });
  root.addEventListener('drop', async (e) => {
    const sec = e.target.closest('.group');
    if (!drag || !sec || sec.dataset.id === drag.from) return;
    e.preventDefault();
    const { from, i } = drag;
    const src = findGroup(from);
    const dst = findGroup(sec.dataset.id);
    if (!src || !dst) return;
    const tab = src.tabs[i];
    // Insert into the target first, then remove from the source: a failure in between
    // can only duplicate a tab, never lose it.
    await updateGroup(dst.id, (x) => { x.tabs.push(tab); }, { snapshot: 'move tab' });
    await updateGroup(src.id, removeTabAt(i, tab.url), { snapshot: null });
  });
}

// ---- import / export / history / settings ---------------------------------
let pendingImport = null;
function previewImport(text) {
  pendingImport = null;
  $('#import-go').disabled = true;
  const out = $('#import-preview');
  if (!text.trim()) { out.textContent = ''; return; }
  try {
    const r = parseImport(text);
    const n = countTabs(r.groups);
    if (!n) { out.textContent = 'No links found in this text.'; return; }
    pendingImport = r;
    out.textContent = `Found ${plural(n, 'tab')} in ${plural(r.groups.length, 'group')}.`;
    $('#import-go').disabled = false;
  } catch (e) {
    out.textContent = `Could not read this: ${e.message}`;
  }
}

async function doImport() {
  if (!pendingImport) return;
  const existing = new Set(state.groups.map((g) => g.id));
  const fresh = pendingImport.groups.filter((g) => !g.id || !existing.has(g.id));
  const skipped = pendingImport.groups.length - fresh.length;
  const made = await addGroups(fresh, { snapshot: 'import' });
  $('#dlg-import').close();
  $('#import-text').value = '';
  previewImport('');
  toast(`Imported ${plural(countTabs(made), 'tab')} in ${plural(made.length, 'group')}${skipped ? ` (${skipped} already on your shelf)` : ''}`,
    () => deleteGroups(made.map((g) => g.id), { reason: 'undo import' }));
}

function exportAs(kind) {
  const day = new Date().toISOString().slice(0, 10);
  const g = state.groups;
  if (kind === 'json') download(`tabhaven-export-${day}.json`, toJSON(g), 'application/json');
  if (kind === 'html') download(`tabhaven-export-${day}.html`, toHTML(g), 'text/html');
  if (kind === 'text') download(`tabhaven-export-${day}.txt`, toText(g), 'text/plain');
  if (kind === 'md') download(`tabhaven-export-${day}.md`, toMarkdown(g), 'text/markdown');
}

const REASONS = {
  'delete group': 'Before deleting a group', 'delete groups': 'Before deleting groups', 'restore group': 'Before restoring a group',
  'restore tab': 'Before opening a tab', 'remove tab': 'Before removing a tab', 'import': 'Before an import', 'edit': 'Before an edit',
  'rename group': 'Before renaming a group', 'move tab': 'Before moving a tab', 'restore version': 'Before restoring a version',
  'undo import': 'Before undoing an import',
};

async function showHistory() {
  const snaps = await listSnapshots();
  const ol = $('#history-list');
  ol.innerHTML = snaps.length
    ? snaps.map((s) => `<li><div><div>${escapeHTML(REASONS[s.reason] || s.reason)}</div><div class="meta">${escapeHTML(formatDate(s.at))} · ${plural(s.tabCount, 'tab')} in ${plural(s.groupCount, 'group')}</div></div><div class="row"><button type="button" data-snap="${s.id}" data-act="dl">Download</button><button type="button" data-snap="${s.id}" data-act="restore">Restore</button></div></li>`).join('')
    : '<li class="hint">No versions yet. One is saved before your first delete, restore, import or edit.</li>';
  $('#dlg-history').showModal();
}

async function onHistoryClick(e) {
  const b = e.target.closest('button[data-snap]');
  if (!b) return;
  const groups = await getSnapshotGroups(Number(b.dataset.snap));
  if (!groups) return;
  if (b.dataset.act === 'dl') return download(`tabhaven-version-${b.dataset.snap}.json`, toJSON(groups), 'application/json');
  if (!confirm(`Replace your shelf with this version (${plural(countTabs(groups), 'tab')})? Your current shelf is saved in history first.`)) return;
  await replaceAll(groups, { reason: 'restore version' });
  $('#dlg-history').close();
  toast('Version restored. The previous state is in History.');
}

function showSettings() {
  const f = $('#dlg-settings form');
  for (const [k, v] of Object.entries(state.settings)) if (f.elements[k]) f.elements[k].checked = !!v;
  $('#dlg-settings').showModal();
}

async function backupNow() {
  toast('Writing backup…');
  const r = await chrome.runtime.sendMessage({ cmd: 'backupNow' });
  if (r?.ok) toast(`Backup written: ${plural(r.tabs, 'tab')}`);
  else toast(`Backup failed: ${r?.error || r?.reason || 'unknown error'}`);
  renderBackupStatus();
}

// ---- wire up ---------------------------------------------------------------
function init() {
  const groupsEl = $('#groups');
  groupsEl.addEventListener('click', onGroupsClick);
  groupsEl.addEventListener('change', onTitleChange);
  groupsEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('gtitle')) e.target.blur(); });
  setupDrag(groupsEl);

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = e.target.value.trim(); render(); }, 80);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea')) { e.preventDefault(); $('#search').focus(); }
    if (e.key === 'Escape' && e.target.id === 'search') { e.target.value = ''; state.query = ''; render(); }
  });

  $('#btn-import').onclick = () => $('#dlg-import').showModal();
  document.querySelectorAll('[data-open="import"]').forEach((b) => (b.onclick = () => $('#dlg-import').showModal()));
  $('#import-text').addEventListener('input', (e) => previewImport(e.target.value));
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    $('#import-text').value = text.length > 200000 ? '' : text;
    $('#import-text').placeholder = text.length > 200000 ? `${file.name} loaded (${Math.round(text.length / 1024)} KB)` : $('#import-text').placeholder;
    previewImport(text);
    e.target.value = '';
  });
  $('#import-go').onclick = doImport;

  $('#btn-export').onclick = () => $('#dlg-export').showModal();
  document.querySelectorAll('[data-export]').forEach((b) => (b.onclick = () => exportAs(b.dataset.export)));
  $('#copy-text').onclick = async () => { await navigator.clipboard.writeText(toText(state.groups)); toast('Copied'); };

  $('#btn-history').onclick = showHistory;
  $('#history-list').addEventListener('click', onHistoryClick);

  $('#btn-settings').onclick = showSettings;
  $('#dlg-settings form').addEventListener('change', async (e) => {
    if (e.target.type === 'checkbox') state.settings = await setSettings({ [e.target.name]: e.target.checked });
    renderBackupStatus();
  });
  $('#backup-now').onclick = backupNow;
  $('#open-folder').onclick = () => chrome.downloads.showDefaultFolder();
  $('#backup-status').addEventListener('click', async (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'backup-now') backupNow();
    if (act === 'enable-backups') { state.settings = await setSettings({ backups: true }); backupNow(); }
  });

  onChanged(scheduleReload);
  setInterval(renderBackupStatus, 30000);
  reload();
}

init();
