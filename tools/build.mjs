// Builds the store packages from src/ (no bundling, plain copies):
//   dist/tabhaven-<version>-chrome.zip   Chrome Web Store / Edge (service worker manifest)
//   dist/tabhaven-<version>-firefox.zip  addons.mozilla.org (background page, gecko id)
// Usage: node tools/build.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
export const GECKO_ID = 'tabhaven@tab-shelf';
// Permissions Firefox does not know: Firefox has no download bubble to hide and no favicon cache API.
const CHROME_ONLY = new Set(['downloads.ui', 'favicon']);

export function firefoxManifest(mf) {
  const out = structuredClone(mf);
  out.background = { scripts: [mf.background.service_worker], type: 'module' };
  out.permissions = mf.permissions.filter((p) => !CHROME_ONLY.has(p));
  delete out.minimum_chrome_version;
  out.browser_specific_settings = {
    gecko: { id: GECKO_ID, strict_min_version: '142.0', data_collection_permissions: { required: ['none'] } },
  };
  return out;
}

function copySrc(dest) {
  rmSync(dest, { recursive: true, force: true });
  cpSync(SRC, dest, { recursive: true });
  return dest;
}

export function buildFirefoxDir(dest) {
  copySrc(dest);
  const mf = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
  writeFileSync(join(dest, 'manifest.json'), JSON.stringify(firefoxManifest(mf), null, 2) + '\n');
  return dest;
}

function zipDir(dir, zipPath) {
  rmSync(zipPath, { force: true });
  execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: dir });
  return zipPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
  const dist = join(ROOT, 'dist');
  mkdirSync(dist, { recursive: true });
  const chrome = zipDir(copySrc(join(dist, 'chrome')), join(dist, `tabhaven-${version}-chrome.zip`));
  const firefox = zipDir(buildFirefoxDir(join(dist, 'firefox')), join(dist, `tabhaven-${version}-firefox.zip`));
  console.log(chrome);
  console.log(firefox);
}
