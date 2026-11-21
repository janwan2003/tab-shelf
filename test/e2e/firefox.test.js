// End-to-end test of the Firefox build (tools/build.mjs buildFirefoxDir) in real Firefox,
// driven over WebDriver by geckodriver (Playwright's Firefox cannot load extensions).
// Skipped when firefox or geckodriver is not installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { buildFirefoxDir, GECKO_ID } from '../../tools/build.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const has = (bin) => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };
const skip = !(has('firefox') && has('geckodriver')) && 'firefox or geckodriver not installed';

const UUID = randomUUID();
const EXT_BASE = `moz-extension://${UUID}/`;
let server, base, driver, wdBase, sid, tmp, downloads;

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wd(method, path, body) {
  const r = await fetch(`${wdBase}${sid ? `/session/${sid}` : ''}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  });
  const j = await r.json();
  if (j.value?.error) throw new Error(`${path}: ${j.value.error}: ${j.value.message}`);
  return j.value;
}
// Runs an async function body in the current tab and returns its result.
async function run(fnBody, ...args) {
  const v = await wd('POST', '/execute/async', {
    script: `const done = arguments[arguments.length - 1]; (async (...a) => { ${fnBody} })(...Array.from(arguments).slice(0, -1)).then(done, (e) => done({ __error: String(e) }));`,
    args,
  });
  if (v && v.__error) throw new Error(v.__error);
  return v;
}
async function until(fnBody, { timeout = 10000, label = fnBody } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await run(fnBody);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${label}`);
    await sleep(150);
  }
}
async function handleWithUrl(prefix) {
  for (const h of await wd('GET', '/window/handles')) {
    await wd('POST', '/window', { handle: h });
    if ((await wd('GET', '/url')).startsWith(prefix)) return h;
  }
  return null;
}
const readDB = () => run(`const db = await import(chrome.runtime.getURL('db.js'));
  return (await db.getAllGroups()).map((g) => ({ id: g.id, urls: g.tabs.map((t) => t.url) }));`);
const tabUrls = () => run(`return (await chrome.tabs.query({})).map((t) => t.url);`);

before(async () => {
  if (skip) return;
  // Snap Firefox can only read and write non-hidden folders under $HOME, so the scratch dir is in the repo.
  tmp = mkdtempSync(join(ROOT, 'tmp-firefox-test-'));
  downloads = join(tmp, 'downloads');
  mkdirSync(downloads);
  const ext = buildFirefoxDir(join(tmp, 'ext'));
  const xpi = join(tmp, 'tabhaven.xpi');
  execFileSync('zip', ['-r', '-q', xpi, '.'], { cwd: ext });

  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>Page ${req.url.slice(1)}</title><p>${req.url}</p>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const port = await freePort();
  driver = spawn('geckodriver', ['--port', String(port), '--allow-system-access'], { stdio: 'ignore' });
  wdBase = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { await fetch(wdBase + '/status'); break; } catch { await sleep(100); } }
  const s = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': {
    args: ['-headless'],
    prefs: {
      'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: UUID }),
      'browser.download.folderList': 2, 'browser.download.dir': downloads, 'browser.download.useDownloadDir': true,
      'browser.download.always_ask_before_handling_new_types': false,
    },
  } } } });
  sid = s.sessionId;
  await wd('POST', '/moz/addon/install', { addon: readFileSync(xpi).toString('base64'), temporary: true });
});

after(async () => {
  if (sid) await wd('DELETE', '').catch(() => {});
  driver?.kill();
  server?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('Firefox: install opens the shelf; saving a window closes its tabs only after the write', { skip }, async () => {
  // onInstalled (reason 'install') opens the shelf by itself.
  let shelf;
  for (let i = 0; i < 50 && !shelf; i++) { shelf = await handleWithUrl(EXT_BASE + 'shelf.html'); if (!shelf) await sleep(200); }
  assert.ok(shelf, 'the shelf opened on install');
  const first = (await wd('GET', '/window/handles')).find((h) => h !== shelf);
  await wd('POST', '/window', { handle: first });
  await wd('POST', '/url', { url: `${base}/a` });
  for (const p of ['b', 'c']) {
    const { handle } = await wd('POST', '/window/new', { type: 'tab' });
    await wd('POST', '/window', { handle });
    await wd('POST', '/url', { url: `${base}/${p}` });
  }
  await wd('POST', '/window', { handle: shelf });
  const r = await run(`const w = await chrome.windows.getCurrent();
    return chrome.runtime.sendMessage({ cmd: 'shelve', scope: 'window', windowId: w.id });`);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.count, 3);
  assert.deepEqual(await tabUrls(), [EXT_BASE + 'shelf.html'], 'only the shelf is left open');
  const groups = await readDB();
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].urls, ['a', 'b', 'c'].map((p) => `${base}/${p}`));
  // The shelf shows the group with letter tiles (Firefox has no favicon cache API).
  const ui = await until(`const g = document.querySelectorAll('.group .tabs li');
    return g.length === 3 && { tiles: document.querySelectorAll('.tabs .fav').length, imgs: document.querySelectorAll('.tabs img').length };`);
  assert.deepEqual(ui, { tiles: 3, imgs: 0 });
});

test('Firefox: backup files land in Downloads/Tabhaven and hold the shelf', { skip }, async () => {
  const st = await run(`return chrome.runtime.sendMessage({ cmd: 'backupNow' });`);
  assert.equal(st.ok, true, JSON.stringify(st));
  const dir = join(downloads, 'Tabhaven');
  for (let i = 0; i < 50 && !existsSync(join(dir, 'tabhaven-backup-latest.html')); i++) await sleep(100);
  const json = JSON.parse(readFileSync(join(dir, 'tabhaven-backup-latest.json'), 'utf8'));
  assert.equal(json.format, 'tabhaven');
  assert.deepEqual(json.groups[0].tabs.map((t) => t.url), ['a', 'b', 'c'].map((p) => `${base}/${p}`));
  const html = readFileSync(join(dir, 'tabhaven-backup-latest.html'), 'utf8');
  assert.match(html, new RegExp(`${base}/c`));
  const daily = (await import('node:fs')).readdirSync(join(dir, 'daily'));
  assert.equal(daily.length, 1);
  // Written a second time: overwritten in place, not "tabhaven-backup-latest(1).json".
  assert.equal((await run(`return chrome.runtime.sendMessage({ cmd: 'backupNow' });`)).ok, true);
  assert.deepEqual((await import('node:fs')).readdirSync(dir).sort(), ['daily', 'tabhaven-backup-latest.html', 'tabhaven-backup-latest.json']);
});

test('Firefox: restore reopens the tabs; a page Firefox refuses stays on the shelf', { skip }, async () => {
  await run(`document.querySelector('.group [data-act="restore"]').click();`);
  // Background tabs report about:blank until their first navigation commits.
  await until(`return (await chrome.tabs.query({})).filter((t) => t.url.startsWith('${base}/')).length === 3;`, { label: '3 tabs reopened' });
  await until(`const db = await import(chrome.runtime.getURL('db.js')); return (await db.getAllGroups()).length === 0;`, { label: 'group removed after restore' });
  assert.deepEqual((await tabUrls()).slice(1).sort(), ['a', 'b', 'c'].map((p) => `${base}/${p}`));

  // Extensions may not open about:config; restoring in a new window must still open the rest.
  await run(`const db = await import(chrome.runtime.getURL('db.js'));
    await db.addGroups([{ tabs: [{ url: 'about:config', title: 'Config' }, { url: '${base}/d', title: 'D' }] }]);`);
  await until(`return document.querySelectorAll('.group').length === 1;`);
  await run(`document.querySelector('.group [data-act="restore-win"]').click();`);
  await until(`return (await chrome.windows.getAll()).length === 2;`, { label: 'new window' });
  await until(`const db = await import(chrome.runtime.getURL('db.js')); const g = await db.getAllGroups();
    return g.length === 1 && g[0].tabs.length === 1;`, { label: 'only the refused tab left' });
  assert.deepEqual((await readDB())[0].urls, ['about:config']);
  await until(`return (await chrome.tabs.query({})).some((t) => t.url === '${base}/d');`, { label: 'd loaded' });
  const wins = await run(`return (await chrome.windows.getAll({ populate: true })).map((w) => w.tabs.map((t) => t.url));`);
  assert.deepEqual(wins.find((w) => !w.includes(EXT_BASE + 'shelf.html')), [`${base}/d`], 'new window holds only the opened tab');
  const msg = await until(`return document.querySelector('#toast')?.textContent;`);
  assert.match(msg, /1 tab could not be opened/);
});
