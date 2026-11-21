---
slug: tab-shelf
stage: launched
priority: 4
url: https://janwan2003.github.io/tab-shelf/
repo: https://github.com/janwan2003/tab-shelf
updated: 2026-11-21
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

**Channels (2026-11-21):**
- **Firefox Add-ons: submitted, in review.** Add-on id 3136867, guid `tabhaven@tab-shelf`, version 0.2.0
  file `unreviewed`, add-on `nominated` (`python3 scripts/amo-submit.py --status`). Listing:
  https://addons.mozilla.org/en-US/firefox/addon/tabhaven-save-tabs-never-lose-/ (live only after approval).
  AMO validation 0 errors / 9 warnings (guarded `downloads.setUiOptions`, escaped `innerHTML`). 1 of 3
  screenshots uploaded (preview 457224, no caption yet). The slug change and the other 2 screenshots hit
  AMO's edit throttle (429, about 25 minutes).
- **Chrome Web Store: blocked.** The studio account is at its 2/2 item limit (operator, OPERATOR-INBOX
  2026-11-20). The package is ready: `dist/tabhaven-<v>-chrome.zip` from `node tools/build.mjs`, also
  attached to GitHub release v0.2.0.
- **Site** https://janwan2003.github.io/tab-shelf/: the button reads "Coming soon to Chrome and Firefox"
  (disabled), with no manual install anywhere; `tabhaven.zip` is no longer deployed (404). Search Console:
  verified, added and sitemap submitted 2026-11-21 (`scripts/gsc.py`).
- **GitHub release v0.2.0** carries the Chrome and Firefox zips (the only place a manual-install file may live).

What exists (v0.2.0, plain ES modules in `src/`; `tools/build.mjs` copies them into a Chrome and a Firefox package):
- MV3 extension: popup (save this window / all windows / this tab / open shelf),
  right-click menus (page; in Firefox also the tab strip), shortcuts Alt+Shift+S (save window) and Alt+Shift+T (open shelf).
- Storage (`db.js`): IndexedDB, every write is a `durability: 'strict'` transaction; a save
  is read back before any tab closes. 30 version snapshots are kept, taken before deletes,
  restores, imports and edits (minor edits at most one every 2 minutes).
- Backups (`backup.js`): about 30 s after a change in Chrome, 2 min in Firefox (Firefox cannot hide the
  download notification, so changes are batched), plus an hourly check. It writes
  `Downloads/Tabhaven/tabhaven-backup-latest.json` + `.html` (a readable page that embeds
  the JSON, so it re-imports) and `daily/tabhaven-backup-<weekday>.json`. Chrome hides the download bubble
  (`downloads.ui`); both erase the entries from the download list. Firefox downloads from a blob: URL.
- Shelf page: groups (rename, star, lock, delete, restore, restore in new window), undo
  toast, search over titles and URLs, drag a tab between groups, "show more" past 300 tabs
  per group, `content-visibility` for big lists, backup-status line, History dialog
  (restore or download any version), Settings, Import (text, any JSON, bookmark HTML,
  Tabhaven backups; skips groups already present by id), Export (JSON/HTML/text/MD).
  Site icons come from Chrome's favicon cache; in Firefox each tab gets a coloured letter tile instead,
  because fetching icons would mean network requests. Restoring keeps any tab the browser refuses
  to open (about:, file:) on the shelf and says so.
- Site in `docs/`: landing page, `switch-from-onetab.html`, `recover-lost-saved-tabs.html`,
  `privacy.html`, og-image.png (1200x630), sitemap.xml, robots.txt. `tools/site/screens.mjs` is the
  page QA (screenshots at 390 and 1280 px, console errors, failed requests, broken links and anchors,
  overflow, alt text).

**Fixed 2026-11-21 (bugs found this session):**
- `updateGroup` saved the *unchanged* group whenever the edit function changed the draft in place
  and returned nothing, which every caller does. So in 0.1.0, rename, star, lock, remove a tab,
  open a single tab and drag between groups looked like they worked until the next reload, but none was saved.
- The remove-tab "×" was `visibility: hidden` until hover, so the keyboard could not reach it and
  touch screens never showed it. Now it uses opacity, shows on `:focus-within`, and is always shown on no-hover devices.
- The search count said "7 matchs".

Verified 2026-11-21 on janeks-pc (Playwright 1.65.1, Chromium build 1255 headless; Firefox 158.0.1 +
geckodriver 0.37.1 headless):
- `node --test test/unit/*.test.js`: 13/13.
- `node --test --test-concurrency=1 test/e2e/*.test.js`: 9/9.
  1–5. The 0.1.0 Chromium tests: save/close only after the write/restore/undo; SIGKILL during a 5,000-tab
       write; update keeps the shelf; backup files then a fresh-profile restore; 10,000 tabs with search and history.
  6. New (Chromium): rename, star, lock (Delete disabled), remove a tab + undo, open one tab (leaves the
     shelf), drag a tab to another group. All are checked in IndexedDB and again after a page reload
     (the starred group sorts first). The 30 s backup alarm then writes the file with no `backupNow` call.
  7–9. New (Firefox, the real Firefox build over WebDriver): install opens the shelf; saving a window closes
     its 3 tabs only after the write, and the shelf shows letter tiles (0 `<img>`); backupNow writes
     latest.json/.html + 1 daily file, and a second backup overwrites them in place (no "(1)" copies);
     Restore all reopens the 3 tabs and empties the shelf; a group with `about:config` + one normal URL
     restored in a new window opens the normal tab and keeps `about:config` on the shelf, with a message.
- The drag step was made to wait 500 ms for re-rendering after it flaked once in CI (below); 3/3 local passes since.
- `web-ext lint` (web-ext 8 via npx) on the Firefox package: 0 errors, 9 warnings (listed above).
- CI: run 44934617887 (commit 4097bd1) test job green, 9/9 e2e on Firefox 160 + Chromium, so the Firefox
  tests ran and were not skipped. Its Pages deploy failed: the upload succeeded, but the deploy step listed only 1 artifact
  (a GitHub-side race; the re-run then failed on a duplicate artifact). Run 44934910305 (commit 354dab4):
  the drag step timed out once, and a re-run of the identical commit passed both jobs, so it was a flake. Pages deployed.
- Live checks (curl, 2026-11-21): `/`, 3 sub-pages, og-image.png, sitemap.xml, robots.txt and the
  Search Console file all return 200; `/tabhaven.zip` returns 404; the home page has 0 matches for zip/unpacked.
- Screenshots checked by eye: the store shots `store/screenshot-{1,2,3}-1280x800.png` (shelf, search,
  history; made by `tools/store-shots.mjs`), and the site home page at 1280 and 390 px. The site agent viewed
  the other site slices (`.tmp/screens/slices`, gitignored).

Not covered yet: right-click menus and keyboard shortcuts have no automated test (WebDriver and Playwright
cannot click browser menus); whether Firefox pops open its downloads panel on each backup was not checked
(headless); a backup re-render during a drag could, in theory, drop the drag; real-user installs: zero so far.

## Metrics

- 2026-11-21: Firefox AMO 0 users (in review, not listed yet; source: `amo-submit.py --status`). Chrome: no
  listing. Search Console: property added today, no data yet.

## Next steps

1. **AMO polish once the throttle clears** (any time after ~19:45 UTC 2026-11-21): set the slug to
   `tabhaven-tab-saver` (PATCH `/addons/addon/tabhaven@tab-shelf/` `{"slug": ...}`; `tabhaven` is taken), then
   run `python3 scripts/amo-submit.py --previews` to upload screenshots 2 and 3 and set the captions.
2. **Every session: check AMO status.** On approval, make the site's main button the official Firefox
   Add-ons button linking to the listing, and keep "Coming soon to Chrome".
3. Chrome Web Store when the operator says the 2/2 limit is raised: upload `dist/tabhaven-<v>-chrome.zip` with
   `ventures/save-image-format/scripts/cws-upload.py` as the template, and write `store/chrome-privacy.md`
   (single purpose, a justification for each permission, data use).
4. Tests for the right-click menu handlers and shortcuts (expose the handler on the background global and
   call it, as Saveform does). Check headed Firefox for a downloads-panel pop on backup; if it pops, write
   one file per backup in Firefox (the HTML embeds the JSON).
5. Reduce the `innerHTML` lint warnings (AMO reviewers read them) by building the rows with DOM APIs or
   a sanitised template helper.
6. Save and restore Chrome tab groups (name and colour); option to restore tabs unloaded (discarded).
7. More SEO pages: "Session Buddy alternative", "export OneTab tabs", "Toby alternative without account".

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
- 2026-11-21 builder (quality + reach): ported to Firefox and **submitted to AMO** (id 3136867, in review), since Chrome is
  blocked by the 2/2 item limit. Found and fixed a 0.1.0 bug where no group edit (rename/star/lock/remove/open-one/drag)
  was ever saved, plus a keyboard/touch-unreachable remove button. Removed the manual zip install from the site
  (charter), and added og:image, sitemap and Search Console (verified). Evidence: unit 13/13, e2e 9/9 (6 Chromium + 3 real
  Firefox) locally and in CI run 44934910305 (re-run of the same commit after a drag flake); web-ext lint 0 errors; live curl 200s, zip 404.
