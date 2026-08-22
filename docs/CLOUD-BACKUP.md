# Not losing your price history

Everything else VGPT.IL knows can be rebuilt by asking the shops again. The
**price history** cannot. It is a record of what games cost on days that have
already gone, gathered a week at a time over months, and it is what the graphs
and the "is this actually a good price?" verdict are made of. Losing it to a new
laptop means losing the only part of the tool that took time to earn.

This is what the tool does about that, and — just as importantly — what it
deliberately does not do.

## What ships today

| | Tracked list & settings | Price history |
|---|---|---|
| **Extension** | Carried by the browser's own account sync | Stays on that machine |
| **Desktop app** | In the backup file | In the backup file |

### Extension — the browser's own sync

The extension mirrors your tracked list and settings into `chrome.storage.sync`.
If you are signed into your browser and have sync switched on, another browser
signed into the same account gets the list. Nothing is asked of you, no account
is created with us, and no credential is ever seen by this extension.

**Price history is not included, and cannot be.** The sync area holds 100KB in
8KB items. A real tracked list's history is around 90KB on its own and grows
every week. Putting history there would mean throwing most of it away and calling
the remainder a backup, which is worse than being straight about the limit.

The merge is **additive only**: a sync brings in games your machine is missing
and never removes what is already there. So deleting a game has to be done on
each machine. That is the right way round — an undeleted game is one row to
remove again; a wrongly deleted one is months of history gone.

If sync is off, or your browser has no account, nothing breaks. The list is still
local, exactly as before.

### Desktop app — a file, in a folder your cloud already syncs

Tray → **גיבוי היסטוריית המחירים**.

Pick a folder and the app writes one JSON file there every day, keeping the last
seven. It offers whatever cloud is already installed on the machine — OneDrive,
Google Drive, Dropbox, iCloud Drive — because the location of the sync folder is
exactly the thing most people do not know off-hand. Any other folder works too.

On a new machine: install, then tray → **שחזור מקובץ גיבוי…** and pick the file.
The restore **merges**: readings already present are not duplicated and local
settings are not overwritten, so it is safe to run onto a machine that already
has data.

The file is written to a temporary name and renamed into place, because a sync
client that catches a half-written file will happily upload a half-written file.

## Why not "sign in with Google" or "sign in with Facebook"

This was the first idea, and it does not survive contact with what those two
actually offer.

### Facebook: there is nowhere to put anything

Facebook Login returns an identity. It does not provide file storage for
applications — there is no Facebook equivalent of a Drive folder. So "back up to
Facebook" can only mean "back up to a server we run, keyed by a Facebook login".

That server is the problem, not the login. This project has no server: the
extension runs entirely in your browser and the desktop app runs entirely on your
machine, which is why nobody's tracked list exists anywhere but their own device.
Adding a server to hold everyone's data would mean hosting costs, a database of
other people's reading habits, a privacy policy that has to be true, and a breach
to worry about — in exchange for a feature a synced folder already provides.

### Google: possible, but it is a decision, not a line of code

Google Drive has an `appDataFolder` — a per-user hidden folder, in the user's own
Drive, that only this application can see. It is genuinely the right shape, and
it is free.

The obstacle is `drive.appdata`, which Google classifies as a **sensitive scope**.
Using it beyond 100 test users requires OAuth verification: a published privacy
policy, a verified domain, a recorded demonstration, and a review that takes
weeks. Until that is done, users see an "unverified app" warning that most people
correctly refuse.

That is a commitment for the project's owner to make deliberately, with a domain
and a privacy policy behind it — not something to slip into a release. And even
once done, it would leave everyone without a Google account with nothing.

### What a synced folder gives instead

- Works with **every** cloud, including Google Drive, and with none.
- No OAuth screen, no verification, no API keys, no expiry.
- No credential ever reaches this application, because there is no credential.
- Nothing of yours is ever held by us, because there is no "us" to hold it.

The file is yours, in your folder, in your cloud. We only put it where you said.

## If you would rather do it by hand

The same file is available without any of the above:

- **Settings → ייצוא** in any build writes the JSON backup.
- **Settings → ייבוא** reads one back in, merging exactly as the restore does.
- `GET /api/export.csv` gives the same history as a spreadsheet, for Excel or
  Sheets. That one is a one-way trip — it is for reading, not for restoring.
