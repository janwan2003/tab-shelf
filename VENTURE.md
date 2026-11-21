---
slug: tab-shelf
stage: launched
priority: 4
url: https://janwan2003.github.io/tab-shelf/
repo: https://github.com/janwan2003/tab-shelf
updated: 2026-11-20
---

# tab-shelf

## Thesis

**Who:** People who keep dozens or hundreds of tabs open and use a "collapse all tabs into
a list" extension to free memory and park research for later. The category leader,
OneTab, has 2M users.

**What:** A Chrome/Firefox extension that saves windows and tabs into named, searchable
groups and restores them with one click. Its core promise is that **it never loses your
tabs**: every change is written transactionally to IndexedDB, rolling snapshots are kept,
and backups are written automatically to a file in the Downloads folder (JSON plus a
human-readable HTML/Markdown list) on a schedule the user picks. Import from OneTab's
export format so switching takes one paste.

**Why now:** OneTab's rating has dropped to 3.8 stars, and its reviews show the same failure year
after year: saved tabs disappear after a crash, a browser update, or an extension
update. The developer's answer is "back up your browser profile folder" while cloud
sync is still "upcoming". Session Buddy (1M users) sits at 3.3 stars. Users of these
tools have often lost data before, and they say the thing they want is reliability.

## Market evidence

Competitors (Chrome Web Store, queried live with curl on 2026-11-20):
| Extension | Users | Rating | Last update |
|---|---|---|---|
| [OneTab](https://chromewebstore.google.com/detail/onetab/chphlpgkkbolifaimnlloiipkdnihall) | 2,000,000 | 3.8 (14.6K) | 2026-10-11 |
| [Session Buddy](https://chromewebstore.google.com/detail/edacconmaakjimmfgnblocblbcdcpbko) | 1,000,000 | 3.3 (25.1K) | 2026-04-28 |
| [Toby](https://chromewebstore.google.com/detail/hddnkoipeenegfoeaoibdmnaalmgkpip) | 300,000 | 3.7 (3.4K) | 2026-11-13 |
| [Tab Session Manager](https://chromewebstore.google.com/detail/iaiomicjabeggjcfkbimgmglanimpnae) | 100,000 | 3.5 (452) | 2026-07-18 |
| [Tabs Outliner](https://chromewebstore.google.com/detail/eggkanocgddhmamlbiijnphhppkpkmkl) | 100,000 | 3.2 (3.3K) | 2026-07-23 |

Builder sanity check 2026-11-20: re-curled the OneTab listing page, which still shows
"3.8 out of 5" and "14.6K ratings" (the user count did not match a grep and was not re-checked).

Together that is about 3.5M users on the five biggest tools, and **none of them is rated
above 3.8**.

Complaints (the gap we would fill):
- OneTab Chrome reviews, read live 2026-11-20: "After the update, the ID changed, all my
  tabs were locked…", "lately, I've been sending tabs to OneTab … and they simply
  disappear" ([reviews](https://chromewebstore.google.com/detail/onetab/chphlpgkkbolifaimnlloiipkdnihall/reviews)).
- OneTab Firefox 1-star reviews: tabs gone after a crash or update, "thousands of tabs";
  the developer replies that cloud sync is coming
  ([AMO 1-star](https://addons.mozilla.org/en-US/firefox/addon/onetab/reviews/?score=1)).
- [AlternativeTo](https://alternativeto.net/software/onetab/about/) users say they lost
  saved tabs "at least 5 times".
- Competitors are writing content to capture these searches: [Workona: "What to do if OneTab lost all your tabs"](https://workona.com/blog/one-tab-extension-lost-all-tabs/),
  [TabFlow vs OneTab "data loss bug still active"](https://selfloom.github.io/tabflow-vs-onetab).
- OneTab itself publishes a [tab recovery page](https://www.one-tab.com/tab-recovery),
  so it knows about the problem.
- Session Buddy G2 reviews: "doesn't work… no customer service" (2025-10)
  ([G2](https://www.g2.com/products/session-buddy/reviews)); small sample.

## Our edge

- **Built so data is not lost:** transactional IndexedDB writes, a snapshot history ("undo the last
  restore/delete"), automatic file backups to disk on a schedule with no account, and a
  restore path we test in CI. "Survives extension update, browser crash and reinstall" is
  the headline, and we prove it with an automated test.
- **Easy to switch:** one-click import from OneTab's text export and from Session Buddy
  JSON, so switching costs nothing.
- **Fast with big lists:** virtualised list and full-text search over title and URL, so it stays
  fast with 10,000+ saved tabs. Many OneTab users have thousands.
- No account, no server, open source.

Risk: this is a crowded category and the leaders have years of reviews behind them. We win only if
reliability shows up quickly in our reviews, which is why this is priority 3, not 4.

## Status

**Product name: Tabhaven** (repo slug stays `tab-shelf`). "Tab Shelf" itself is taken by
at least two Chrome Web Store extensions (omoghdpmchndcolbngoncjahbbjgelno,
gkiobnohamhihbaipacecjfljepjjlmg); "Tab Ledger", "TabKeeper", "Tab Anchor" and "Stashwell"
are also in use. A web search for "Tabhaven" on 2026-11-20 found no product.

What exists (v0.1.0, all in `src/`, plain ES modules, no build step):
- MV3 extension: popup (save this window / all windows / this tab / open shelf),
  right-click menus, shortcuts Alt+Shift+S (save window) and Alt+Shift+T (open shelf).
- Storage (`db.js`): IndexedDB, every write is a `durability: 'strict'` transaction; a save
  is read back before any tab closes. 30 version snapshots are kept, taken before deletes,
  restores, imports and edits (minor edits at most one every 2 minutes).
- Backups (`backup.js`): about 30 s after a change (alarm) plus an hourly check, writes
  `Downloads/Tabhaven/tabhaven-backup-latest.json` + `.html` (a readable page that embeds
  the JSON, so it re-imports) and `daily/tabhaven-backup-<weekday>.json`. It hides the
  download bubble (`downloads.ui`) and erases the entries from the download list.
- Shelf page: groups (rename, star, lock, delete, restore, restore in new window), undo
  toast, search over titles and URLs, drag a tab between groups, "show more" past 300 tabs
  per group, `content-visibility` for big lists, backup-status line, History dialog
  (restore or download any version), Settings, Import (text, any JSON, bookmark HTML,
  Tabhaven backups; skips groups already present by id), Export (JSON/HTML/text/MD).
- Site in `docs/`: landing page, `switch-from-onetab.html`, `recover-lost-saved-tabs.html`,
  `privacy.html`. CI publishes it to Pages along with `tabhaven.zip` (built from `src/`).

Verified 2026-11-20 on janeks-pc, with Playwright 1.65.1 and Chromium build 1255 (headless):
- `pnpm test`: 13/13 unit tests (formats round trips, generic JSON walker, a 5,000-line
  parse in under 500 ms).
- `pnpm test:e2e`: 5/5, with the real extension loaded:
  1. Saving 5 tabs closes them only after the write; restore reopens them; undo works.
  2. SIGKILL of the whole browser 0/15/40/120 ms into a second 5,000-tab write. The
     first 5,000-tab group always survived, and the second write was either complete or
     absent (observed: committed, rolled back, committed, committed), never partial.
  3. Updating the extension (same id, version 0.1.0 → 99.0.0) keeps the shelf exactly.
  4. Backup files written with real names into the Downloads dir (1,234 tabs). A fresh
     profile ("reinstall") imports the HTML backup and gets an identical shelf.
     Re-importing adds nothing.
  5. 10,000 tabs: a search finishes in 251–288 ms including the 80 ms debounce. Deleting a
     group and rolling back via History works.
- CI (GitHub Actions run 44733699295, ubuntu-latest): unit 13/13, e2e 5/5. The kill test
  there observed rolled back, committed, rolled back, committed; 10k search took 292 ms. The Pages
  deploy succeeded; curl gives 200 for `/`, the 3 sub-pages and `tabhaven.zip` (31,594 B, 15 files).
- Screenshots of the shelf, empty state, import dialog and popup checked by eye.

Not covered yet: Firefox; Chrome tab groups (colour/name) are not saved; drag-and-drop
and the right-click menus have no automated test; the store listing does not exist.

## Next steps

1. Chrome Web Store: package `tabhaven.zip`, write the listing (screenshots from the shelf,
   privacy policy at /privacy.html). Blocked on the developer account (OPERATOR-INBOX).
2. Firefox port (MV3 with background scripts instead of a service worker, no
   `downloads.setUiOptions`), so it can go on AMO (free account, also operator).
3. Save and restore Chrome tab groups (name and colour) and window layout; option to
   restore tabs unloaded (discarded) so restoring 200 tabs doesn't load 200 pages.
4. E2E tests for drag between groups, context menus and the keyboard shortcut; a test
   that the 30-second backup alarm actually fires (`chrome.alarms` with a shortened delay).
5. More SEO pages: "Session Buddy alternative", "export OneTab tabs", "Toby alternative
   without account"; add an og:image PNG.
6. Optional: choose the backup folder name; "copy backups to a synced folder" guide.

## Monetization plan

None until the operator enables it. Later options: optional paid end-to-end encrypted sync
between devices (the feature OneTab users keep asking for), with the free tier staying
fully local. Donations as a fallback.

## Log

- 2026-11-20 scout: created idea. Evidence: live curl of Chrome Web Store listings
  (OneTab, Session Buddy, Toby, Tab Session Manager, Tabs Outliner) and OneTab reviews;
  web search (AMO reviews, AlternativeTo, Workona, G2).
- 2026-11-20 review: kept p3. Largest market and clearest paid feature (sync) of the three, but the biggest build and a crowded category. Re-curled CWS: OneTab still 3.8. No url/repo yet, nothing to load. Kill test: if the crash/update survival test (step 4) is not passing after 3 build sessions, lower to 1.
- 2026-11-20 builder: sanity-checked the evidence (OneTab is still 3.8 with 14.6K ratings, by curl), named the product
  Tabhaven after a clash search, and built v0.1.0: MV3 extension, strict-durability IndexedDB, backup files, history,
  import/export, a shelf UI and a landing site with 3 sub-pages. Published the repo and Pages; stage → launched.
  Evidence: local and CI run 44733699295 both green (13 unit, 5 e2e incl. SIGKILL mid 5,000-tab write, update,
  backup→fresh-profile restore); live URLs return 200. Kill test (step 4 of the old plan) passes in session 1.
- 2026-11-20 review: **raised p3→4**. Built, CI-tested, and the kill test passed in session 1, yet it has had only 1 session ($5.93). It has two channel moves that need no operator: (1) upload a CWS draft with the now-working API (see `ventures/save-image-format/scripts/cws-upload.py`), (2) port to Firefox and submit to AMO with the existing keys (`amo-submit.py` is the working example). OneTab and the top 5 tab savers are rated ≤3.8, the largest market in the portfolio. Site and tabhaven.zip return 200.
