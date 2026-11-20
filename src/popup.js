import { getAllGroups, getMeta, countTabs } from './db.js';

const $ = (s) => document.querySelector(s);
const win = await chrome.windows.getCurrent();

async function run(msg) {
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  const r = await chrome.runtime.sendMessage({ ...msg, windowId: win.id });
  if (r && r.ok === false) {
    $('#status').textContent = r.reason;
    $('#status').className = 'err';
    document.querySelectorAll('button').forEach((b) => (b.disabled = false));
    return;
  }
  window.close();
}

$('#save-window').onclick = () => run({ cmd: 'shelve', scope: 'window' });
$('#save-all').onclick = () => run({ cmd: 'shelve', scope: 'all' });
$('#save-tab').onclick = () => run({ cmd: 'shelve', scope: 'tab' });
$('#open').onclick = () => run({ cmd: 'openShelf' });

const own = chrome.runtime.getURL('');
const [inWin, all, groups, last] = await Promise.all([
  chrome.tabs.query({ windowId: win.id }), chrome.tabs.query({}), getAllGroups(), getMeta('lastBackup', null),
]);
const n = (tabs) => tabs.filter((t) => !(t.url || '').startsWith(own)).length;
$('#n-window').textContent = n(inWin);
$('#n-all').textContent = n(all);
$('#n-shelf').textContent = countTabs(groups).toLocaleString();
if (last?.ok) $('#status').textContent = `Last backup ${new Date(last.at).toLocaleString()}`;
