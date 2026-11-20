# Tabhaven

Save every tab in a window to a searchable shelf with one click, and never lose them.
A Chrome (Manifest V3) extension. No account, no server, no tracking.

Website: https://janwan2003.github.io/tab-shelf/

## Why it doesn't lose your tabs

- **Close after commit.** Tabs are saved in a strict-durability IndexedDB transaction and read
  back before any tab is closed. If the save fails, the tabs stay open.
- **Backup files.** Within about 30 seconds of every change, Tabhaven writes
  `Downloads/Tabhaven/tabhaven-backup-latest.json` and `.html` (a readable link list that can
  also be re-imported), plus 7 rotating daily copies in `Downloads/Tabhaven/daily/`. They
  survive uninstalling, reinstalling and changes of extension id.
- **Version history.** A copy of the shelf is kept before every delete, restore, import and
  edit (the last 30), and any of them can be restored or downloaded.
- **Tested.** CI loads the real extension in Chromium and kills the browser while a
  5,000-tab write is in flight, updates the extension to a new version, restores a fresh
  profile from the backup file, and checks that nothing is lost (`test/e2e/`).

## Features

Save this window, all windows or one tab (toolbar popup, right-click menu, `Alt+Shift+S`);
restore a tab, a group, or a group into a new window; rename, star, lock; drag tabs between
groups; search over titles and URLs (fast with 10,000+ tabs); undo; import from "URL | title"
text exports, JSON exports of other tab managers, bookmark HTML files and plain URL lists;
export as JSON, HTML, text or Markdown.

## Install (until the Chrome Web Store listing is live)

1. Download [tabhaven.zip](https://janwan2003.github.io/tab-shelf/tabhaven.zip) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.

## Develop

```
pnpm install
pnpm exec playwright install chromium
pnpm test        # unit tests: import/export formats
pnpm test:e2e    # extension tests in real Chromium
```

The extension is plain ES modules in `src/` with no build step. The website is in `docs/`.
`tools/make-icons.py` draws the icons.
