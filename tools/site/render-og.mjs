// Renders docs/og-image.png (1200x630) from tools/site/og-image.html.
// The template gets docs/style.css, docs/favicon.svg and the hero illustration from
// docs/index.html inlined, so the image stays in step with the site.
// Usage: node tools/site/render-og.mjs
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const docs = join(root, 'docs');

const [template, css, favicon, index] = await Promise.all([
  readFile(join(here, 'og-image.html'), 'utf8'),
  readFile(join(docs, 'style.css'), 'utf8'),
  readFile(join(docs, 'favicon.svg'), 'utf8'),
  readFile(join(docs, 'index.html'), 'utf8'),
]);

const ill = index.match(/<svg class="illustration"[\s\S]*?<\/svg>\s*(?=<\/div>)/);
if (!ill) throw new Error('Hero illustration (<svg class="illustration">) not found in docs/index.html');

const html = template
  .replace('/*SITE_CSS*/', () => css)
  .replace('<!--FAVICON-->', () => favicon.replace(/<title>[\s\S]*?<\/title>/, ''))
  .replace('<!--ILLUSTRATION-->', () => ill[0]);

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setContent(html, { waitUntil: 'load' });
  const out = join(docs, 'og-image.png');
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
