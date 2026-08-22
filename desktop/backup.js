const { app, dialog, Notification, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Getting someone's price history onto their next machine.
 *
 * Everything else this tool holds can be rebuilt by asking the shops again. The
 * price HISTORY cannot: it is a record of what things cost on days that have
 * gone, gathered a week at a time over months, and it is the thing the graphs
 * and the "is this actually a good price" verdict are made of. Losing it to a
 * new laptop is losing the only part of the tool that took time to earn.
 *
 * WHY A FILE IN A SYNCED FOLDER, AND NOT "SIGN IN WITH GOOGLE":
 *
 * The obvious-sounding version — connect a Google or Facebook account and keep
 * the data there — does not survive contact with what those two actually offer.
 * Facebook has no file storage for applications at all; a Facebook login gives
 * identity and nothing to put anything in, so "back up to Facebook" would mean
 * "back up to a server we run", which this project does not have and does not
 * want. Google does have somewhere to put it (Drive's per-app folder), but that
 * scope is a sensitive one: using it beyond a hundred testers requires Google's
 * OAuth verification, with a published privacy policy, a verified domain and a
 * review. That is a decision for the project's owner to make deliberately, not
 * something to slip into a release — and it would still leave every user without
 * a Google account with nothing.
 *
 * Whereas: every one of those clouds already puts a folder on the machine that
 * syncs itself. Writing a file into it needs no account, no OAuth screen, no
 * verification, no server, and no credential ever touching this application —
 * and it works identically for OneDrive, Google Drive, Dropbox and iCloud. The
 * user's cloud stays the user's cloud. We just put the file where they told us.
 *
 * docs/CLOUD-BACKUP.md carries the full comparison.
 */

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'backup.json');
/** Daily. Price capture itself only runs weekly by default; anything finer is churn. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
/** How many dated backups to keep before the oldest is removed. */
const KEEP = 7;
const FILE_PREFIX = 'vgpt-il-backup-';

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
    return {
      folder: typeof raw.folder === 'string' ? raw.folder : null,
      auto: raw.auto !== false,
      lastAt: typeof raw.lastAt === 'string' ? raw.lastAt : null,
      lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    };
  } catch {
    return { folder: null, auto: true, lastAt: null, lastError: null };
  }
}

function saveSettings(next) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(next, null, 2));
  } catch (err) {
    console.error(`backup: could not save settings — ${err.message}`);
  }
}

/**
 * Folders on this machine that a cloud already syncs.
 *
 * Detected rather than asked for, because "put it somewhere that gets backed up"
 * is advice most people cannot act on: the sync folder's location is exactly the
 * thing they do not know. Every candidate is checked for existence, so nothing
 * is ever offered that is not really there.
 */
function cloudFolders() {
  const home = app.getPath('home');
  const candidates = [
    // OneDrive publishes its own location; the consumer and work variants differ.
    [process.env.OneDrive, 'OneDrive'],
    [process.env.OneDriveConsumer, 'OneDrive'],
    [process.env.OneDriveCommercial, 'OneDrive (עבודה)'],
    // Google Drive for desktop: the modern mount, then the legacy folder.
    [path.join(home, 'My Drive'), 'Google Drive'],
    [path.join(home, 'Google Drive'), 'Google Drive'],
    ['G:\\My Drive', 'Google Drive'],
    [path.join(home, 'Dropbox'), 'Dropbox'],
    [path.join(home, 'iCloudDrive'), 'iCloud Drive'],
    [path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), 'iCloud Drive'],
  ];
  const seen = new Set();
  const out = [];
  for (const [dir, label] of candidates) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    try {
      if (fs.statSync(dir).isDirectory()) out.push({ dir: path.join(dir, 'VGPT.IL'), label });
    } catch {
      /* not installed on this machine */
    }
  }
  return out;
}

/** Today's file name, so a second backup on the same day replaces the first. */
const fileFor = (when = new Date()) => `${FILE_PREFIX}${when.toISOString().slice(0, 10)}.json`;

/** Remove all but the newest KEEP backups, so a synced folder never grows without limit. */
function prune(folder) {
  try {
    const mine = fs
      .readdirSync(folder)
      .filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith('.json'))
      .sort();
    for (const f of mine.slice(0, Math.max(0, mine.length - KEEP))) {
      fs.rmSync(path.join(folder, f), { force: true });
    }
  } catch (err) {
    console.error(`backup: could not prune old backups — ${err.message}`);
  }
}

/**
 * Write one backup. Returns the path written, or throws.
 *
 * The file is written whole to a temporary name and then renamed over the target,
 * because the destination is a folder something else is actively watching and
 * uploading: a sync client that catches a half-written file uploads a half-written
 * file, and the copy in the cloud is the one that matters here.
 */
async function writeBackup(port, folder) {
  const res = await fetch(`http://127.0.0.1:${port}/api/export`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`the app's own export refused (${res.status})`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length < 2) throw new Error('the export came back empty');

  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, fileFor());
  const temp = `${target}.part`;
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, target);
  prune(folder);
  return target;
}

/** A backup on demand. `interactive` decides whether silence or a dialog is the right answer. */
async function backupNow(port, interactive) {
  const settings = loadSettings();
  if (!settings.folder) {
    if (interactive) await chooseFolder(port);
    return;
  }
  try {
    const file = await writeBackup(port, settings.folder);
    saveSettings({ ...settings, lastAt: new Date().toISOString(), lastError: null });
    console.log(`backup: wrote ${file}`);
    if (interactive) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'VGPT.IL',
        message: 'הגיבוי נשמר.',
        detail: file,
      });
    }
  } catch (err) {
    saveSettings({ ...settings, lastError: err.message });
    console.error(`backup: failed — ${err.message}`);
    if (interactive) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'VGPT.IL',
        message: 'הגיבוי נכשל.',
        detail: err.message,
      });
    } else if (Notification.isSupported()) {
      new Notification({ title: 'VGPT.IL', body: `הגיבוי האוטומטי נכשל: ${err.message}` }).show();
    }
  }
}

/** Pick where backups go, offering whatever cloud this machine already has. */
async function chooseFolder(port) {
  const clouds = cloudFolders();
  const buttons = [...clouds.map((c) => c.label), 'תיקייה אחרת…', 'ביטול'];
  let picked = null;

  if (clouds.length > 0) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      title: 'VGPT.IL',
      message: 'לאן לגבות את היסטוריית המחירים?',
      detail:
        'הגיבוי הוא קובץ אחד. תיקייה שמסתנכרנת לענן פירושה שהוא כבר נמצא גם שם — ' +
        'בלי חשבון, בלי הרשאות, ובלי שהאפליקציה נוגעת בסיסמה שלכם.\n\n' +
        clouds.map((c) => `${c.label}: ${c.dir}`).join('\n'),
    });
    if (response === buttons.length - 1) return null;
    if (response < clouds.length) picked = clouds[response].dir;
  }

  if (!picked) {
    const result = await dialog.showOpenDialog({
      title: 'בחירת תיקיית גיבוי',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    picked = result.filePaths[0];
  }

  saveSettings({ ...loadSettings(), folder: picked, lastError: null });
  await backupNow(port, true);
  return picked;
}

/**
 * Bring a backup back in.
 *
 * The server MERGES rather than replaces — same-day, same-store readings are
 * de-duplicated and local settings are kept — so restoring onto a machine that
 * already has data cannot destroy what is there. That is what makes it safe to
 * offer this as a single menu item with no warnings to click through.
 */
async function restore(port) {
  const settings = loadSettings();
  const result = await dialog.showOpenDialog({
    title: 'שחזור מגיבוי',
    defaultPath: settings.folder ?? undefined,
    filters: [{ name: 'גיבוי VGPT.IL', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return;
  const file = result.filePaths[0];

  try {
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    const res = await fetch(`http://127.0.0.1:${port}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`the app refused the file (${res.status})`);
    const { games, points } = await res.json();
    await dialog.showMessageBox({
      type: 'info',
      title: 'VGPT.IL',
      message: 'השחזור הושלם.',
      detail:
        `נוספו ${games} משחקים ו‑${points} מדידות מחיר.\n\n` +
        'שחזור מוסיף ולא מוחק: מדידות שכבר היו כאן לא שוכפלו, וההגדרות המקומיות נשמרו.',
    });
  } catch (err) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'VGPT.IL',
      message: 'השחזור נכשל.',
      detail: err.message,
    });
  }
}

/** Open the backup folder in the file manager — the quickest way to sanity-check it. */
function openFolder() {
  const { folder } = loadSettings();
  if (folder && fs.existsSync(folder)) void shell.openPath(folder);
}

/**
 * Start the daily backup. Runs one shortly after launch as well, because a
 * machine that is only on for a few hours a day would otherwise never reach the
 * interval — which is exactly the machine whose owner needs this most.
 */
function startBackups(port) {
  const first = setTimeout(() => {
    if (loadSettings().auto) void backupNow(port, false);
  }, 3 * 60 * 1000);
  const timer = setInterval(() => {
    if (loadSettings().auto) void backupNow(port, false);
  }, INTERVAL_MS);
  for (const t of [first, timer]) if (typeof t.unref === 'function') t.unref();
}

module.exports = {
  writeBackup,
  backupNow,
  chooseFolder,
  cloudFolders,
  loadSettings,
  saveSettings,
  openFolder,
  restore,
  startBackups,
};
