// Store screenshots (1280x800) of the real shelf page with a realistic shelf, into store/.
// The extension is loaded from a copy of src/ without the 'favicon' permission, so tabs show the
// letter tiles that Firefox shows (Chromium's favicon cache is empty in a fresh profile).
// Usage: node tools/store-shots.mjs
import { chromium } from 'playwright';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'tabhaven-shots-'));
const ext = join(work, 'ext');
cpSync(join(ROOT, 'src'), ext, { recursive: true });
const mf = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
mf.permissions = mf.permissions.filter((p) => p !== 'favicon');
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(mf));
mkdirSync(join(ROOT, 'store'), { recursive: true });

const day = 86400000;
const now = Date.now();
const G = (title, ageDays, tabs, extra = {}) => ({
  title, createdAt: now - ageDays * day, ...extra,
  tabs: tabs.map(([title, url]) => ({ title, url })),
});
const groups = [
  G('Kitchen renovation', 0.02, [
    ['Small kitchen layouts that work: 12 floor plans', 'https://www.houseandplans.example/kitchen-layouts'],
    ['Quartz vs granite countertops: cost, care and looks', 'https://www.homeguide.example/quartz-vs-granite'],
    ['Under-cabinet LED strip lighting buying guide', 'https://www.lightinglab.example/under-cabinet-led'],
    ['Range hood sizing calculator', 'https://www.ventcalc.example/range-hood'],
    ['How to tile a backsplash (step by step)', 'https://www.diyhandbook.example/tile-backsplash'],
    ['Open shelving ideas - 40 photos', 'https://www.interiorsdaily.example/open-shelving'],
  ], { starred: true }),
  G('Thesis: sleep and memory', 1, [
    ['Sleep-dependent memory consolidation - review', 'https://journals.example.org/neuro/sleep-memory-review'],
    ['Slow-wave sleep and declarative memory (2019)', 'https://journals.example.org/sleep/sws-declarative'],
    ['Targeted memory reactivation: a meta-analysis', 'https://journals.example.org/psych/tmr-meta'],
    ['Zotero - group library', 'https://www.zotero.org/groups'],
    ['Overleaf - thesis draft', 'https://www.overleaf.com/project'],
    ['REM sleep - Wikipedia', 'https://en.wikipedia.org/wiki/Rapid_eye_movement_sleep'],
    ['Actigraphy vs polysomnography accuracy', 'https://journals.example.org/sleep/actigraphy-psg'],
  ], { locked: true }),
  G('Trip to Lisbon', 3, [
    ['Lisbon in 4 days: an itinerary', 'https://www.travelnotes.example/lisbon-4-days'],
    ['Tram 28 route and tips', 'https://www.lisbonguide.example/tram-28'],
    ['Sintra day trip from Lisbon', 'https://www.lisbonguide.example/sintra'],
    ['Flights LIS - compare dates', 'https://www.flightsearch.example/lis'],
    ['Pastéis de nata: where locals go', 'https://www.foodmap.example/lisbon-nata'],
  ]),
  G('', 6, [
    ['Hacker News', 'https://news.ycombinator.com/'],
    ['The Rust Programming Language', 'https://doc.rust-lang.org/book/'],
    ['MDN: IndexedDB API', 'https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API'],
    ['Designing Data-Intensive Applications - notes', 'https://www.readingnotes.example/ddia'],
  ]),
];

const ctx = await chromium.launchPersistentContext(join(work, 'profile'), {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
const page = await ctx.newPage();
await page.goto(`chrome-extension://${id}/shelf.html`);
await page.evaluate(async (gs) => {
  const db = await import('./db.js');
  await db.addGroups(gs.reverse());
  // A few history entries so the History dialog has content.
  const all = await db.getAllGroups();
  await db.updateGroup(all[0].id, (x) => { x.title = x.title || 'Reading'; }, { snapshot: 'rename group', minor: false });
}, groups);
// Simulate a recent backup so the status line shows the normal, healthy state.
await page.evaluate(async () => {
  const db = await import('./db.js');
  const gs = await db.getAllGroups();
  await db.setMeta('lastBackup', { ok: true, at: Date.now() - 4 * 60000, path: 'Tabhaven/tabhaven-backup-latest.json', groups: gs.length, tabs: db.countTabs(gs), dirtyAt: Date.now() });
});
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('a.tab').length > 10);
// Hide the setup page the extension opened on install.
for (const p of ctx.pages()) if (p !== page) await p.close();

const shot = (n) => page.screenshot({ path: join(ROOT, 'store', `screenshot-${n}-1280x800.png`) });
await shot(1);
await page.fill('#search', 'guide');
await page.waitForTimeout(400);
await shot(2);
await page.fill('#search', '');
await page.waitForTimeout(300);
await page.click('#btn-history');
await page.waitForTimeout(300);
await shot(3);
await ctx.close();
rmSync(work, { recursive: true, force: true });
console.log('wrote store/screenshot-{1,2,3}-1280x800.png');
