// Screenshot QA for the static site in docs/.
//
// Serves docs/ on a local HTTP server, opens every page at phone (390x844, DPR 2) and
// desktop (1280x800) size, and:
//   - saves full-page screenshots to .tmp/screens/<page>-<viewport>.png, plus
//     viewport-height slices in .tmp/screens/slices/ so details are readable;
//   - collects console errors, uncaught page errors, failed requests and HTTP >= 400;
//   - checks every local href (page and #fragment) resolves to a served page and an
//     element with that id; checks local src/href assets load;
//   - flags horizontal overflow (scrollWidth or innerWidth > configured viewport width)
//     and names the elements that stick out;
//   - flags <img> without an alt attribute and role="img" SVGs without a <title>;
//   - warns (does not fail) on small tap targets on the phone viewport and on
//     placeholder-looking text.
// External links (other hosts) are listed but not fetched.
//
// FAQ <details> are opened before the screenshot, so their content is checked too.
//
// Usage: node tools/site/screens.mjs [--dark] [--no-slices]
// Exit code 1 if any error (not warning) was found.
import { createServer } from 'node:http';
import { readFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const docs = join(root, 'docs');
const outDir = join(root, '.tmp', 'screens');
const args = new Set(process.argv.slice(2));

const PAGES = ['index.html', 'switch-from-onetab.html', 'recover-lost-saved-tabs.html', 'privacy.html'];
const VIEWPORTS = [
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
];
const SCHEMES = args.has('--dark') ? ['light', 'dark'] : ['light'];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain', '.js': 'text/javascript',
};

// ---- static server ----
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(docs, path));
    if (!file.startsWith(docs)) throw new Error('outside docs');
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'slices'), { recursive: true });

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const shots = [];
const externalLinks = new Set();
const localTargets = new Map(); // "page.html#id" -> first place it was linked from

const browser = await launchBrowser();
try {
  for (const scheme of SCHEMES) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ ...vp, colorScheme: scheme, reducedMotion: 'reduce' });
      for (const pageName of PAGES) {
        const tag = `${pageName.replace('.html', '')}-${vp.name}${scheme === 'dark' ? '-dark' : ''}`;
        const page = await ctx.newPage();
        page.on('console', (m) => { if (m.type() === 'error') err(tag, `console error: ${m.text()}`); });
        page.on('pageerror', (e) => err(tag, `page error: ${e.message}`));
        page.on('requestfailed', (r) => err(tag, `request failed: ${r.url()} (${r.failure()?.errorText})`));
        page.on('response', (r) => { if (r.status() >= 400) err(tag, `HTTP ${r.status()}: ${r.url()}`); });

        await page.goto(`${origin}/${pageName}`, { waitUntil: 'networkidle' });

        // Compare against the configured width, not innerWidth: with isMobile, Chrome widens the
        // layout viewport to fit overflowing content, so innerWidth would hide the overflow.
        const check = () => page.evaluate((vw) => {
          const overflow = Math.max(document.documentElement.scrollWidth, window.innerWidth) - vw;
          const wide = [];
          if (overflow > 0) {
            for (const el of document.querySelectorAll('body *')) {
              const r = el.getBoundingClientRect();
              if (r.right > vw + 0.5 && r.width > 0) {
                const id = el.id ? `#${el.id}` : '';
                const cls = el.classList.length ? `.${[...el.classList].join('.')}` : '';
                wide.push(`${el.tagName.toLowerCase()}${id}${cls} right=${Math.round(r.right)}`);
              }
            }
          }
          return { vw, overflow, wide: wide.slice(0, 8) };
        }, vp.viewport.width);

        const closed = await check();
        if (closed.overflow > 0) err(tag, `horizontal overflow ${closed.overflow}px (details closed): ${closed.wide.join(', ')}`);
        await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
        const open = await check();
        if (open.overflow > 0) err(tag, `horizontal overflow ${open.overflow}px (details open): ${open.wide.join(', ')}`);

        const info = await page.evaluate(() => {
          const links = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
          const assets = [...document.querySelectorAll('[src], link[href]')]
            .map((e) => e.getAttribute('src') || e.getAttribute('href'));
          const imgNoAlt = [...document.querySelectorAll('img:not([alt])')].map((i) => i.getAttribute('src'));
          const svgNoTitle = [...document.querySelectorAll('svg[role="img"]')]
            .filter((s) => !s.querySelector(':scope > title') && !s.getAttribute('aria-label')).length;
          // Tap targets: interactive elements that are not inline text links.
          const small = [];
          for (const el of document.querySelectorAll('a[href], button, summary, input, select, textarea')) {
            const cs = getComputedStyle(el);
            if (cs.display === 'inline') continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.height < 40 || r.width < 40) {
              small.push(`${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
            }
          }
          const text = document.body.innerText;
          const placeholder = (text.match(/\b(lorem ipsum|TODO|TBD|FIXME|placeholder|example\.invalid|XXX)\b/gi) || []);
          const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
          const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
          const meta = {
            canonical: !!document.querySelector('link[rel="canonical"]'),
            ogImage: !!document.querySelector('meta[property="og:image"]'),
            twitterCard: document.querySelector('meta[name="twitter:card"]')?.content,
          };
          return { links, assets, imgNoAlt, svgNoTitle, small, placeholder, dupIds, meta };
        });

        for (const src of info.imgNoAlt) err(tag, `img without alt: ${src}`);
        if (info.svgNoTitle) err(tag, `${info.svgNoTitle} role="img" svg(s) without a title`);
        if (info.dupIds.length) err(tag, `duplicate ids: ${[...new Set(info.dupIds)].join(', ')}`);
        if (!info.meta.canonical) err(tag, 'no canonical link');
        if (!info.meta.ogImage) err(tag, 'no og:image');
        if (info.meta.twitterCard !== 'summary_large_image') err(tag, `twitter:card is ${info.meta.twitterCard}`);
        if (vp.name === 'phone') for (const s of info.small) warn(tag, `small tap target: ${s}`);
        for (const p of info.placeholder) warn(tag, `placeholder-like text: "${p}"`);

        for (const href of info.links) {
          const u = new URL(href, `${origin}/${pageName}`);
          if (u.origin !== origin) { if (/^https?:/.test(u.protocol)) externalLinks.add(u.href); continue; }
          const target = `${u.pathname.replace(/^\//, '') || 'index.html'}${u.hash}`;
          if (!localTargets.has(target)) localTargets.set(target, tag);
        }
        for (const a of info.assets) {
          const u = new URL(a, `${origin}/${pageName}`);
          if (u.origin === origin && !localTargets.has(u.pathname.slice(1))) localTargets.set(u.pathname.slice(1), tag);
        }

        const file = join(outDir, `${tag}.png`);
        await page.screenshot({ path: file, fullPage: true });
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        shots.push(`${file} (${vp.viewport.width}x${height} CSS px)`);

        if (!args.has('--no-slices')) {
          const sliceH = vp.viewport.height * 1.5;
          for (let y = 0, i = 1; y < height; y += sliceH, i++) {
            await page.screenshot({
              path: join(outDir, 'slices', `${tag}-${String(i).padStart(2, '0')}.png`),
              fullPage: true,
              clip: { x: 0, y, width: vp.viewport.width, height: Math.min(sliceH, height - y) },
            });
          }
        }
        await page.close();
      }
      await ctx.close();
    }
  }

  // ---- resolve local links and anchors ----
  const page = await browser.newPage();
  for (const [target, from] of localTargets) {
    const [path, hash] = target.split('#');
    const res = await page.request.get(`${origin}/${path}`);
    if (res.status() !== 200) { err(from, `broken local link: ${target} (HTTP ${res.status()})`); continue; }
    if (hash) {
      await page.goto(`${origin}/${path}`);
      const found = await page.evaluate((id) => !!document.getElementById(decodeURIComponent(id)), hash);
      if (!found) err(from, `broken anchor: ${target}`);
    }
  }
  await page.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`Pages: ${PAGES.length} x viewports: ${VIEWPORTS.map((v) => v.name).join(', ')} x schemes: ${SCHEMES.join(', ')}`);
console.log(`Screenshots (${shots.length}):\n  ${shots.join('\n  ')}`);
console.log(`Local link/asset targets checked: ${localTargets.size}`);
console.log(`External links (not fetched): ${externalLinks.size}\n  ${[...externalLinks].join('\n  ')}`);
console.log(`\nWarnings (${warnings.length}):${warnings.length ? '\n  ' + warnings.join('\n  ') : ' none'}`);
console.log(`Errors (${errors.length}):${errors.length ? '\n  ' + errors.join('\n  ') : ' none'}`);
process.exitCode = errors.length ? 1 : 0;
