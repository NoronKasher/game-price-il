# VGPT.IL — משווה מחירי משחקים

**A Hebrew-first, right-to-left game price comparison and wishlist tracker built for the Israeli market.**
It answers one question properly: *where is this game actually cheapest for me, right now, and is this a good time to buy it?*

### ▶ [Try the live demo](https://noronkasher.github.io/game-price-il/)

The demo is the real app running against a **snapshot of real prices** recorded on one day. It is served
from GitHub Pages, which runs no server — so nothing is scraped live there. See
[Demo limits](#demo-limits) for exactly what is and isn't real.

![The price board for Elden Ring](docs/screenshots/board.png)

---

## Why this exists

Buying a game in Israel is a mess of incomparable prices:

- **The same digital game costs wildly different amounts by store region.** Elden Ring above is ₪179 on
  the Israeli Steam page and ₪101 on the Indonesian one — a real difference that most price sites,
  which quote a single region, never show you.
- **Physical discs are still competitive here**, and the shops that sell them are small local retailers
  that no international price tracker has ever indexed.
- **Key resellers sit somewhere in between** — often genuinely cheaper, occasionally region-locked in a
  way that makes the key useless to an Israeli buyer.

So the tool compares all three side by side — official store, disc, and key reseller — converts
everything to shekels, and says plainly which risks come attached.

## What it does

**Compares 16 sources in one search.** Steam (per-region), PlayStation Store, Xbox, Nintendo, Epic,
Ubisoft Connect, EA App, CheapShark, GG.deals, IsThereAnyDeal, and six Israeli retailers —
VGS, Player1, Arcadia, Game Storm, Ivory and Bug.

**Shows regional prices honestly.** Every offer says which region it is from, and foreign-region rows
carry a badge explaining what can go wrong — a store may require a payment method from that country, a
key may be locked to it. The tool never blocks a purchase and never pretends to be the seller; it says
what it knows and lets you decide.

**Tracks prices over time and tells you whether now is a good moment.** A tracked game records its price
on a schedule, and the verdict beside it — *cheapest ever recorded*, *cheapest since March*, *12% above
its low* — is judged against that game's own history, on the same price series shown next to it.

**Alerts on real drops**, globally or per game, scoped so a game you track for a disc in a Tel Aviv shop
is never judged on a US digital price.

**Knows about Eilat.** Israel's free-trade-zone city has no VAT, and some chains publish a separate,
genuinely lower Eilat price. Where a shop publishes one, the tool shows it. It is never estimated —
a discount that exists only in our arithmetic would be worse than none.

![Search results with store filters and the region warning](docs/screenshots/search.png)

**Works on a phone**, and in Hebrew RTL throughout.

![The wishlist with price verdicts](docs/screenshots/wishlist.png)

## The scraping ethic

**No bot-protection bypassing, ever.** This is a hard rule in the project, not a preference:

- No CAPTCHA solving, no Cloudflare circumvention, no rotating proxies or forged fingerprints.
- Every store gets a minimum 2.5s gap between requests, a daily budget, and exponential back-off on
  429/503/403.
- `robots.txt` is respected. Several Israeli retailers are **absent from the list above for exactly this
  reason** — they disallow it, or sit behind a challenge we won't work around. They stay unsupported.

The practical cost is real coverage we can't have. That's the correct trade.

## Demo limits

The [live demo](https://noronkasher.github.io/game-price-il/) is honest about being a recording:

| | In the demo |
|---|---|
| Prices | **Real, recorded on one day.** Frozen — nothing updates. |
| Games | The banner names every title in the recording, and clicking one searches it. Anything else finds nothing. |
| Results | **Only cards the snapshot can actually price are shown.** A recorded search returns dozens of games; the capture can afford boards for a few of them, so the rest are hidden rather than opening onto an empty board. |
| Changes you make | Kept for your visit, gone on reload — there is no database. |
| Price history & graphs | Real: ~700 recorded price points across four games over a month. |
| Add-on (DLC) search | Recorded for a couple of titles, so the add-on panel has real data to open. |
| Sale alerts | The bell is empty on purpose — alert messages are one person's inbox, so they aren't published. |
| Live scraping, alerts, auto-capture | Server features — they need a running Node process. |
| **With the extension installed** | **The demo goes live**: searches run against the real stores instead of the snapshot. See below. |

Run it locally to get all of it.

## Why there is no free hosted live demo

Free hosting that runs this properly does exist — there is a `render.yaml`
blueprint in the repo for exactly that. The blocker is not the bill.

**One capture costs ~176 requests across the stores, and the tool's own limit is
200 per host per day.** That budget is sized for one person's wishlist. Shared
between strangers on a public URL, the first visitor or two would use up the
day's allowance and everyone after them would be told the stores are rate
limited — a demo that works until someone shares the link. Raising the ceiling
would mean one server scraping small Israeli shops on behalf of every passer-by,
which is the opposite of the deal this project makes with them.

The extension is the answer that scales: each person's own browser, their own
address, their own small budget. Nothing to host, nothing to pay for, and no
shop ever sees a crowd arriving through one door.

What free infrastructure IS good for is keeping the recording fresh:
`.github/workflows/refresh-demo.yml` re-captures weekly (Actions minutes are
unmetered on public repos), and `npm run demo:verify` refuses to publish a
snapshot that lost the Israeli retailers or its tracking history — a runner that
gets treated differently from a person's browser must fail loudly, not ship a
demo with the local shops quietly missing.

## Why the demo cannot be live on its own

A page served from GitHub Pages may only fetch a server that opts in with CORS
headers, and the stores that matter here do not. Measured from the demo itself:

| source | a web page may fetch it |
|---|---|
| CheapShark | yes |
| Steam | **no** |
| VGS, Ivory (Israeli retailers) | **no** |

That is the browser's same-origin policy, not something the code can work
around. The only ways past it are a proxy server — which would mean hosting, and
routing strangers' scraping through it — or an extension, which has host
permissions.

So the demo does the third thing: **if the VGPT extension is installed, the demo
detects it and searches live.** The banner turns green and says so; without the
extension nothing changes and it stays the recording.

The bridge is deliberately narrow. It relays `search`, `offers`, `meta` and
`sources` — nothing else. The extension can also read and modify tracked games,
and a web page has no business reaching that, so the content script refuses
anything outside that list even though the page is our own.

## Run it locally

Needs **Node 24+** (the server runs TypeScript directly, with no build step).

```bash
npm install
npm run dev
```

That starts the API on `localhost:5174` and the web app on `localhost:5173`. Price history is a SQLite
file under `data/` — local to your machine and git-ignored.

For a single-process production run:

```bash
npm run build && NODE_ENV=production npm start
```

### Optional API keys

GG.deals and IsThereAnyDeal need a key registered to *you* — their terms are personal-use, so this tool
ships none. Add yours in the app's settings screen, or as `GG_DEALS_API_KEY` / `ITAD_API_KEY`. Without
them the other 14 sources work normally.

## How it works

```
server/src/
  adapters/     one module per store, all behind a common SourceAdapter interface
  fanout.ts     the cross-store search — no host in sight, shared with the extension
  politeFetch   per-host rate limiting, daily budgets, back-off
  search.ts     query parsing, title normalization, grouping
  capture.ts    scheduled price recording
  verdict.ts    "is this a good price?" judged against a game's own history
  health.ts     daily canary — catches a store that silently returns nothing
web/src/
  DepartureBoard.tsx   the split-flap price board
  api.ts               three interchangeable clients: server, demo snapshot, extension
extension/src/
  background.ts        the service worker — the same adapters, no server
```

Adding a store means writing one adapter with `search` and `getOffers`. Nothing else changes.

**The health canary matters more than it sounds.** A scraper doesn't fail loudly when a site redesigns —
it returns zero results and looks like a game nobody sells. A daily probe with a known-good query treats
*empty* as a failure state, which is the only way to notice.

```bash
npm test      # 103 tests, ~2.6s
```

## Browser extension

A local server is the wrong shape for a shopping tool — nobody installs one to
check a price. So the whole tool also runs inside a Chromium extension, where
there is no separate process and nothing listening on a port: the MV3 service
worker imports **the same store adapters, unchanged**.

```bash
npm run build:ext     # -> extension/dist, load it unpacked
npm run package:ext   # -> extension/vgpt-il-extension-<version>.zip
```

Verified end to end in a real browser: **all 16 sources, 100 results in 3.9s**
from live stores, matching the Node server source-for-source. Tracking a game
records its prices, and both the tracked game and its history are still there
after the service worker is killed and restarted.

It ported cheaply because **not one adapter imports a `node:` module**. Only
three modules needed a browser stand-in, each swapped by one alias:

| server | extension | why |
|---|---|---|
| `db.ts` (SQLite) | IndexedDB | tracking, history, alerts, CSV export |
| `keys.ts` (key file) | `chrome.storage` | GG.deals / ITAD bring-your-own-key |
| `psnHash.ts` (Playwright) | stub | PlayStation searches on the known hash, but cannot yet re-learn a rotated one |

Everything above storage — capture, verdicts, alerts, notifications, CSV — is
shared, not reimplemented.

**Politeness had to be rebuilt to survive the worker.** MV3 kills the service
worker after ~30s idle, and the 2.5s spacing, the daily budget and the
stand-down after a 429 all lived in process memory. Nothing would have errored —
the counters would simply have reset and we would have started scraping harder
than promised. The limits now live in `chrome.storage`, and four tests plus a
live browser run confirm a back-off, a spent budget and the spacing all still
apply after a restart.

**The tool still introduces itself.** A browser refuses to let `fetch()` set
`User-Agent`, so the honest identification `politeFetch` sends on the server is
applied by a `declarativeNetRequest` rule instead — scoped to exactly the hosts
we scrape, and verified arriving on the wire rather than assumed.

**An extension does not change what we are allowed to fetch.** Stores that state
they refuse automated access still refuse it, and running from a user's browser
would only make that undetected rather than permitted. Coverage is decided by
the rules above, not by what happens to be technically reachable.

**Your tracked list follows the browser account.** It is mirrored into
`chrome.storage.sync`, so another browser signed into the same account gets it —
no account with us, no OAuth screen, no credential this extension ever sees.
Price history stays local: the sync quota is 100KB in 8KB items and a real
history is around 90KB and growing, so including it would mean discarding most
of it and calling the rest a backup. A pull only ever adds, never deletes, so
nothing you track here can disappear because of something that happened
elsewhere. Six tests cover the chunking, the quota overflow and the merge; the
desktop app's file backup is the answer for keeping history
([docs/CLOUD-BACKUP.md](docs/CLOUD-BACKUP.md)).

Not yet wired: background price capture (the `alarms` permission is declared but
no alarm is registered, so the extension only re-prices when the app is open),
the search autocomplete (it races store typeaheads on every keystroke, which
behind a message port means waking the worker per character), the deals ticker
and the adapter canary — both scheduled server jobs.

## Desktop app

The extension is the main way to use this, and for most people the better one.
The desktop build exists for the one thing an extension genuinely cannot do:
**keep recording prices while the browser is closed.** MV3 stops its worker
seconds after it goes idle and `chrome.alarms` only fire while the browser runs,
so a weekly price check depends on the browser being open when it comes due. A
desktop process does not have that problem.

```bash
npm run desktop          # builds the UI, bundles the server, opens the app
npm run desktop:smoke    # headless check that it starts and answers
npm run package:desktop  # -> dist_electron/VGPT.IL Setup <version>.exe
```

It is a background service with a window attached, not the reverse: closing the
window hides it and price capture carries on, and quitting is a deliberate
choice from the tray.

Two things had to change to make packaging possible. The server normally runs
straight from TypeScript on Node 24's type stripping, which a packaged app
cannot rely on — so `npm run build:server` bundles it to ordinary JavaScript.
And the app runs that bundle with **Electron's own Node**, so nothing needs Node
installed on the machine.

Price history lives in the operating system's per-user application data, not
beside the program, so updating or moving the app cannot take it with it. Store
links open in the real browser, where the user's sessions and payment details
already are — never inside this window.

Closing the window says so the first time rather than vanishing into the tray
silently, and the tray offers to start with the machine — a tracker that only
runs when someone remembers to open it records gaps.

**Verified end to end**: with a tracked list due for a check, the background
process recorded 261 new price points on its own, with no window open and no
browser running. One shop was politely backed off; the rest carried on.

### It repairs PlayStation with its own browser

When Sony rotates the persisted-query hash its store search uses, 22 PlayStation
regions vanish at once. The source build recovers it by driving an installed
Chrome or Edge through `playwright-core` — which a packaged desktop build cannot
do, because its server is bundled into a single file and Playwright resolves
browser paths at runtime in a way no bundler can follow.

So the desktop build uses the Chromium it already is. It loads the public store
page out of sight, reads the hash out of the request that page makes, and hands
it back to its own server. No dependency, no download, and **nothing is touched
until the store has actually refused us** — the server raises a flag only after a
live call was rejected, and all that runs on a timer is a question asked over
localhost.

```bash
npm run desktop:psn-hash   # PSN HASH OK: 4df6284f… (2.5s, no server needed)
```

### Updates and What's New

The app checks GitHub Releases for a newer version, downloads it in the
background, and then **asks before installing** — this thing's job is to keep
running, so restarting it for something nobody requested is the opposite of the
point. After an update it opens its release notes once. Both the app's notes and
the browser store's listing are generated from `changelog.json`, so they cannot
drift apart.

> The installer is **unsigned**. Windows SmartScreen will warn on first run, and
> on each update, until a code-signing certificate is in place.

### Backups, and moving to a new machine

Tray → **גיבוי היסטוריית המחירים**. Pick a folder — the app offers whatever
cloud is already installed (OneDrive, Google Drive, Dropbox, iCloud) — and it
writes one file a day there, keeping the last seven. On a new machine, restore
from the same file; the restore merges, so nothing already recorded is
duplicated or overwritten.

Why a file in a synced folder rather than "sign in with Google": Facebook has no
file storage for applications at all, and Google's app-data scope needs OAuth
verification before it works for more than a hundred testers. A synced folder
works with every cloud and with none, and no credential ever reaches this
application. The full reasoning is in [docs/CLOUD-BACKUP.md](docs/CLOUD-BACKUP.md).

The extension solves the smaller half of the same problem with the browser's own
account sync: the tracked list and settings travel, price history does not — it
is far larger than the 100KB sync quota, and squeezing it in would mean throwing
most of it away and calling the rest a backup.

## Refreshing the demo snapshot

```bash
npm run demo:capture              # top up: whatever is missing or stale
npm run demo:capture -- --limit 12  # a bounded batch
npm run demo:verify               # refuse to publish a degraded snapshot
npm run build:demo                # builds the static demo into web/dist-demo
```

**The capture is incremental because it has to be.** One title costs each Israeli
shop about three requests, and the tool holds itself to 200 per shop per day —
so the sixty-title library fills up over several days rather than being taken in
one sitting. A run that starts getting refused stops itself and says so.

Two guards keep a refresh from making things worse: a re-capture never replaces
a recording with one that has fewer stores answering, and `demo:verify` refuses
to publish a snapshot that lost the Israeli retailers or its tracking history.

Committing the snapshot redeploys the demo via GitHub Actions.

## Status

Working and in daily use, with real gaps: PlayStation needs a periodically-refreshed query hash
(the app recovers it automatically when a Chromium browser is present), search results still carry
noise from store catalogs, and the UI is Hebrew-only for now.

## License

Copyright © 2026 Noron Kasher

Licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).

You may use, study, modify and redistribute this software. The AGPL's condition is
reciprocity: **if you run a modified version as a network service, you must offer its source
to that service's users.** Regular use, self-hosting an unmodified copy, and contributing back
are all unaffected.

---

*Built for the Israeli market, where the price you see is rarely the price you should pay.*
