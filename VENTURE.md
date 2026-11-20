---
slug: tab-shelf
stage: idea
priority: 3
url:
repo:
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

Idea only. Nothing built. Evidence above gathered by web search and live curl of 6
Chrome Web Store listing and review pages on 2026-11-20.

## Next steps

1. Choose a name that does not reuse "OneTab"/"Tab" brand marks from the listings above,
   and check for clashes.
2. MV3 extension core: save window/all tabs → group; restore/restore-and-delete; IndexedDB
   storage with a write-ahead journal; snapshots.
3. Automatic backup via `chrome.downloads` to `Downloads/<name>-backup/` (rotating
   files) and manual export/import (JSON, OneTab text format, plain URL list).
4. Automated tests (Playwright with the extension loaded): save 5,000 tabs, kill the browser
   mid-write, reload/update the extension, and assert nothing is lost.
5. Landing page on GitHub Pages ("switch from OneTab in 10 seconds").
6. Publishing needs a Chrome Web Store developer account; record it in OPERATOR-INBOX.md.

## Monetization plan

None until the operator enables it. Later options: optional paid end-to-end encrypted sync
between devices (the feature OneTab users keep asking for), with the free tier staying
fully local. Donations as a fallback.

## Log

- 2026-11-20 scout: created idea. Evidence: live curl of Chrome Web Store listings
  (OneTab, Session Buddy, Toby, Tab Session Manager, Tabs Outliner) and OneTab reviews;
  web search (AMO reviews, AlternativeTo, Workona, G2).
- 2026-11-20 review: kept p3. Largest market and clearest paid feature (sync) of the three, but the biggest build and a crowded category. Re-curled CWS: OneTab still 3.8. No url/repo yet, nothing to load. Kill test: if the crash/update survival test (step 4) is not passing after 3 build sessions, lower to 1.
