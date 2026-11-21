// End-to-end tests with the real extension loaded in Chromium.
// Run: PLAYWRIGHT_BROWSERS_PATH=.browsers node --test test/e2e/*.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXT = resolve('src');
const work = mkdtempSync(join(tmpdir(), 'tabhaven-e2e-'));
const downloads = join(work, 'downloads');
let server, base;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>Page ${req.url.slice(1)}</title><p>${req.url}</p>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

async function launch(profile, ext = EXT) {
  // Point Chrome's own download folder at a temp dir (as a user's Downloads folder).
  const prefs = join(work, profile, 'Default', 'Preferences');
  if (!existsSync(prefs)) {
    mkdirSync(join(work, profile, 'Default'), { recursive: true });
    writeFileSync(prefs, JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true } }));
  }
  const ctx = await chromium.launchPersistentContext(join(work, profile), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  // Undo Playwright's download interception so chrome.downloads behaves as in a normal
  // browser: real file names, sub-folders and overwrite.
  const page = ctx.pages()[0] || (await ctx.newPage());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
  return { ctx, sw, extId, profile };
}

async function openShelf(b) {
  const page = await b.ctx.newPage();
  await page.goto(`chrome-extension://${b.extId}/shelf.html`);
  await page.waitForFunction(() => document.querySelector('#stats').textContent.length > 0 || !document.querySelector('#empty').hidden);
  return page;
}

// Ground truth straight from IndexedDB, read inside an extension page.
async function readDB(page) {
  return page.evaluate(async () => {
    const db = await import('./db.js');
    const groups = await db.getAllGroups();
    return groups.map((g) => ({ id: g.id, title: g.title, n: g.tabs.length, urls: g.tabs.map((t) => t.url) }));
  });
}

function killBrowser(profile) {
  // SIGKILL every process of this browser profile: no shutdown handlers run.
  try { execFileSync("pkill", ["-KILL", "-f", "--", `--user-data-dir=${join(work, profile)}`]); } catch {}
}

const bigList = (n, tag) => Array.from({ length: n }, (_, i) => `${base}/${tag}/${i} | ${tag} page ${i}`).join('\n');

async function importText(page, text) {
  await page.click('#btn-import');
  await page.evaluate((t) => {
    const ta = document.querySelector('#import-text');
    ta.value = t;
    ta.dispatchEvent(new Event('input'));
  }, text);
  await page.click('#import-go');
}

test('save all tabs, they close only after the write, restore and undo', async () => {
  const b = await launch('p1');
  const pages = [];
  for (let i = 0; i < 5; i++) {
    const p = await b.ctx.newPage();
    await p.goto(`${base}/tab${i}`);
    pages.push(p);
  }
  const shelf = await openShelf(b);
  const r = await shelf.evaluate(() => chrome.runtime.sendMessage({ cmd: 'shelve', scope: 'all' }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.count, 5);
  const db = await readDB(shelf);
  assert.deepEqual(db.flatMap((g) => g.urls).sort(), Array.from({ length: 5 }, (_, i) => `${base}/tab${i}`));
  await shelf.waitForFunction(() => document.querySelectorAll('a.tab').length === 5);
  for (const p of pages) assert.ok(p.isClosed(), 'saved tab should be closed');
  // Titles came along.
  assert.ok((await shelf.textContent('#groups')).includes('Page tab0'));

  // Restore every group: the tabs come back and leave the shelf.
  while ((await shelf.$$('button[data-act="restore"]')).length) {
    await shelf.click('button[data-act="restore"]');
    await shelf.waitForTimeout(300);
  }
  const open = b.ctx.pages().map((p) => p.url());
  for (let i = 0; i < 5; i++) assert.ok(open.includes(`${base}/tab${i}`), `tab${i} reopened`);
  assert.equal((await readDB(shelf)).length, 0);

  // Undo the last restore puts that group back.
  await shelf.click('#toast button');
  await shelf.waitForFunction(() => document.querySelectorAll('a.tab').length > 0);
  assert.ok((await readDB(shelf)).length >= 1);
  await b.ctx.close();
});

test('a browser killed during a 5,000-tab write loses nothing that was saved', async () => {
  let b = await launch('p2');
  let shelf = await openShelf(b);
  await importText(shelf, bigList(5000, 'first'));
  await shelf.waitForFunction(() => /5,000 tabs/.test(document.querySelector('#stats').textContent), null, { timeout: 30000 });

  for (const delay of [0, 15, 40, 120]) {
    // Start a second 5,000-tab write and kill the browser while it runs.
    await importText(shelf, bigList(5000, `second-${delay}`));
    await new Promise((r) => setTimeout(r, delay));
    killBrowser(b.profile);
    await b.ctx.close().catch(() => {});

    b = await launch('p2');
    shelf = await openShelf(b);
    const db = await readDB(shelf);
    const first = db.filter((g) => g.urls[0].includes('/first/'));
    assert.equal(first.length, 1, `delay ${delay}: the committed group survived`);
    assert.equal(first[0].n, 5000);
    // Every group is complete: a write is all or nothing.
    for (const g of db) assert.equal(g.n, 5000, `delay ${delay}: group ${g.urls[0]} has ${g.n} tabs`);
    // Clean up the second group if it landed, to keep the next round comparable.
    console.log(`kill after ${delay} ms: second write ${db.length === 2 ? 'committed in full' : 'rolled back in full'}`);
    const extra = db.filter((g) => !g.urls[0].includes('/first/')).map((g) => g.id);
    if (extra.length) await shelf.evaluate(async (ids) => (await import('./db.js')).deleteGroups(ids), extra);
  }
  await b.ctx.close();
});

test('updating the extension to a new version keeps the shelf', async () => {
  // Load a copy so its manifest version can be bumped; same path means same extension id.
  const ext = join(work, 'ext-copy');
  cpSync(EXT, ext, { recursive: true });
  let b = await launch('p3', ext);
  const shelf = await openShelf(b);
  await importText(shelf, bigList(300, 'update'));
  await shelf.waitForFunction(() => /300 tabs/.test(document.querySelector('#stats').textContent));
  const before = await readDB(shelf);
  const id = b.extId;
  await b.ctx.close();

  const manifestPath = join(ext, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = '99.0.0';
  writeFileSync(manifestPath, JSON.stringify(manifest));

  b = await launch('p3', ext);
  assert.equal(b.extId, id);
  assert.equal(await b.sw.evaluate(() => chrome.runtime.getManifest().version), '99.0.0');
  const again = await openShelf(b);
  assert.deepEqual(await readDB(again), before);
  await b.ctx.close();
});

test('backup files are written, and a fresh install restores from them', async () => {
  const b = await launch('p4');
  const shelf = await openShelf(b);
  await importText(shelf, bigList(1200, 'backup') + '\n\n' + bigList(34, 'second'));
  await shelf.waitForFunction(() => /1,234 tabs/.test(document.querySelector('#stats').textContent));
  // A change schedules a backup alarm in the service worker.
  const alarm = await b.sw.evaluate(() => chrome.alarms.get('backup-soon'));
  assert.ok(alarm, 'a backup is scheduled after a change');
  const r = await shelf.evaluate(() => chrome.runtime.sendMessage({ cmd: 'backupNow' }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const dir = join(downloads, 'Tabhaven');
  const json = join(dir, 'tabhaven-backup-latest.json');
  assert.ok(existsSync(json), `backup at ${json}; found ${existsSync(dir) ? readdirSync(dir) : 'no dir'}`);
  assert.ok(existsSync(join(dir, 'tabhaven-backup-latest.html')));
  assert.equal(readdirSync(join(dir, 'daily')).length, 1);
  const data = JSON.parse(readFileSync(json, 'utf8'));
  assert.equal(data.groups.reduce((n, g) => n + g.tabs.length, 0), 1234);
  // The backup does not leave entries in the downloads list.
  assert.equal((await b.sw.evaluate(() => chrome.downloads.search({}))).length, 0);
  // Status line reports it.
  await shelf.reload();
  await shelf.waitForFunction(() => /Backed up/.test(document.querySelector('#backup-status').textContent));
  const original = await readDB(shelf);
  await b.ctx.close();

  // "Reinstall": a brand-new profile, then import the HTML backup through the UI.
  const fresh = await launch('p4-fresh');
  const s2 = await openShelf(fresh);
  assert.equal(await s2.isVisible('#empty'), true);
  await s2.click('#empty button[data-open="import"]');
  await s2.setInputFiles('#import-file', join(dir, 'tabhaven-backup-latest.html'));
  await s2.waitForFunction(() => !document.querySelector('#import-go').disabled);
  await s2.click('#import-go');
  await s2.waitForFunction(() => /1,234 tabs/.test(document.querySelector('#stats').textContent));
  assert.deepEqual(await readDB(s2), original);
  // Importing the same backup again adds nothing.
  await s2.click('#btn-import');
  await s2.setInputFiles('#import-file', json);
  await s2.waitForFunction(() => !document.querySelector('#import-go').disabled);
  await s2.click('#import-go');
  await s2.waitForTimeout(500);
  assert.equal((await readDB(s2)).length, original.length);
  await fresh.ctx.close();
});

test('10,000 saved tabs: shelf renders and search stays fast; history can roll back', async () => {
  const b = await launch('p5');
  const shelf = await openShelf(b);
  const groups = Array.from({ length: 20 }, (_, g) => bigList(500, `g${g}`)).join('\n\n');
  await importText(shelf, groups);
  await shelf.waitForFunction(() => /10,000 tabs/.test(document.querySelector('#stats').textContent), null, { timeout: 30000 });
  const t0 = Date.now();
  await shelf.fill('#search', 'g7 page 499');
  await shelf.waitForFunction(() => /^1 match/.test(document.querySelector('#stats').textContent));
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, `search took ${ms} ms`);
  console.log(`search over 10,000 tabs: ${ms} ms (includes 80 ms debounce)`);
  await shelf.fill('#search', '');

  // Delete a group, then roll back through History.
  await shelf.click('button[data-act="del"]');
  await shelf.waitForFunction(() => /9,500 tabs/.test(document.querySelector('#stats').textContent));
  shelf.on('dialog', (d) => d.accept());
  await shelf.click('#btn-history');
  await shelf.click('#history-list button[data-act="restore"]');
  await shelf.waitForFunction(() => /10,000 tabs/.test(document.querySelector('#stats').textContent));
  await b.ctx.close();
});

// Ground truth with every field the shelf's edit actions touch.
const readGroups = (page) => page.evaluate(async () => {
  const db = await import('./db.js');
  return (await db.getAllGroups()).map((g) => ({ title: g.title, starred: !!g.starred, locked: !!g.locked, urls: g.tabs.map((t) => t.url) }));
});
const byFirst = (groups, url) => groups.find((g) => g.urls.includes(url));

test('group edits are saved: rename, star, lock, remove a tab, open one tab, drag between groups; the backup alarm fires', async (t) => {
  const b = await launch('p6');
  t.after(() => b.ctx.close().catch(() => {}));
  const shelf = await openShelf(b);
  const A = (i) => `${base}/alpha/${i}`;
  const B = (i) => `${base}/beta/${i}`;
  await importText(shelf, [0, 1, 2].map((i) => `${A(i)} | Alpha ${i}`).join('\n') + '\n\n' + [0, 1].map((i) => `${B(i)} | Beta ${i}`).join('\n'));
  await shelf.waitForFunction(() => document.querySelectorAll('a.tab').length === 5);
  const sec = (url) => shelf.locator('section.group', { has: shelf.locator(`a.tab[href="${url}"]`) });

  // Rename (committed on change).
  const unique = `Research ${Date.now()}`;
  await sec(A(0)).locator('.gtitle').fill(unique);
  await sec(A(0)).locator('.gtitle').press('Enter');
  await sec(A(0)).locator('.gtitle').blur();
  await waitFor(async () => byFirst(await readGroups(shelf), A(0)).title === unique, 'rename saved');

  // Star and lock.
  await sec(B(0)).locator('[data-act="star"]').click();
  await waitFor(async () => byFirst(await readGroups(shelf), B(0)).starred, 'star saved');
  await sec(B(0)).locator('[data-act="lock"]').click();
  await waitFor(async () => byFirst(await readGroups(shelf), B(0)).locked, 'lock saved');
  await waitFor(() => sec(B(0)).locator('[data-act="del"]').isDisabled(), 'a locked group cannot be deleted');

  // Remove one tab, then undo.
  await shelf.hover(`li:has(a[href="${A(2)}"])`);
  await sec(A(0)).locator(`li:has(a[href="${A(2)}"]) .rm`).click();
  await waitFor(async () => byFirst(await readGroups(shelf), A(0)).urls.length === 2, 'tab removed');
  await shelf.click('#toast button');
  await waitFor(async () => byFirst(await readGroups(shelf), A(0)).urls.length === 3, 'undo brings the tab back');

  // Open one tab: it opens and leaves the (unlocked) group.
  const opened = b.ctx.waitForEvent('page');
  await shelf.click(`a.tab[href="${A(1)}"]`);
  await (await opened).waitForURL(A(1));
  await waitFor(async () => !byFirst(await readGroups(shelf), A(0)).urls.includes(A(1)), 'opened tab left the shelf');

  // Drag a tab from the Alpha group to the Beta group.
  await shelf.waitForFunction((u) => !document.querySelector(`a.tab[href="${u}"]`), A(1));
  await shelf.locator(`li:has(a[href="${A(2)}"])`).dragTo(sec(B(0)).locator('.ghead'));
  await waitFor(async () => {
    const g = await readGroups(shelf);
    return byFirst(g, B(0)).urls.includes(A(2)) && !byFirst(g, A(0)).urls.includes(A(2));
  }, 'tab moved');

  // Edits survive a reload of the shelf page.
  await shelf.reload();
  await shelf.waitForFunction(() => document.querySelectorAll('a.tab').length === 4);
  assert.equal(await sec(A(0)).locator('.gtitle').inputValue(), unique);
  assert.equal(await shelf.locator('section.group').first().locator('a.tab').first().getAttribute('href'), B(0), 'starred group sorts first');

  // No backupNow here: the 30-second alarm scheduled by the edits writes the file by itself.
  const latest = join(downloads, 'Tabhaven', 'tabhaven-backup-latest.json');
  await waitFor(() => existsSync(latest) && readFileSync(latest, 'utf8').includes(unique), 'alarm-driven backup', 75000);
  const json = JSON.parse(readFileSync(latest, 'utf8'));
  assert.deepEqual(json.groups.find((g) => g.title === unique).tabs.map((t) => t.url), [A(0)]);
  await b.ctx.close();
});

async function waitFor(fn, label, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
