const { app, BrowserWindow, dialog, shell, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Keeping the desktop app current, and telling people what changed.
 *
 * An extension is updated by the browser store without anyone thinking about it.
 * A downloaded application is not: without this, every fix would reach only the
 * people who happen to visit the repository again, and a price tool that has
 * gone stale looks exactly like a price tool that is broken — the stores it
 * scrapes change their pages, and an old build silently reports "not sold here".
 *
 * TWO RULES, both about not being presumptuous with someone's machine:
 *
 *  1. It downloads on its own but NEVER restarts on its own. This app's job is
 *     to keep running in the background; killing it mid-capture to install
 *     something the user did not ask for is the opposite of that. The update is
 *     fetched quietly and then waits — for a yes, or for the next quit.
 *
 *  2. The What's-New page opens ONCE per version, after an update actually
 *     landed. Not on every launch, and not on the first install either: someone
 *     who just chose to install this does not need to be told what is new in it.
 */

const SEEN_FILE = () => path.join(app.getPath('userData'), 'seen-version.json');

/** electron-updater is only meaningful in a packaged build; from source there is nothing to update. */
function updater() {
  if (!app.isPackaged) return null;
  try {
    return require('electron-updater').autoUpdater;
  } catch (err) {
    console.error(`updates: electron-updater is missing from this build — ${err.message}`);
    return null;
  }
}

/* ─────────────────────────── What's new ─────────────────────────── */

let notesWindow = null;

function showPatchNotes() {
  if (notesWindow && !notesWindow.isDestroyed()) {
    notesWindow.show();
    notesWindow.focus();
    return;
  }
  const file = path.join(__dirname, 'patch-notes.html');
  if (!fs.existsSync(file)) {
    console.error('updates: patch-notes.html is missing — run "npm run changelog"');
    return;
  }
  notesWindow = new BrowserWindow({
    width: 720,
    height: 780,
    title: 'VGPT.IL — מה חדש',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  notesWindow.loadFile(file);
  // The notes are a static page; any link in them belongs in a real browser.
  notesWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  notesWindow.on('closed', () => {
    notesWindow = null;
  });
}

function lastSeenVersion() {
  try {
    return JSON.parse(fs.readFileSync(SEEN_FILE(), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

function rememberVersion(version) {
  try {
    fs.mkdirSync(path.dirname(SEEN_FILE()), { recursive: true });
    fs.writeFileSync(SEEN_FILE(), JSON.stringify({ version }));
  } catch (err) {
    console.error(`updates: could not record the seen version — ${err.message}`);
  }
}

/**
 * Show the notes if this is a version the user has not been shown yet AND they
 * have run an earlier one. A first install records the version silently: being
 * greeted by a changelog for software you have never used is noise.
 */
function showPatchNotesIfUpdated() {
  const now = app.getVersion();
  const seen = lastSeenVersion();
  rememberVersion(now);
  if (seen && seen !== now) showPatchNotes();
}

/* ─────────────────────────── Updating ─────────────────────────── */

/** Hours between background checks. The app runs for weeks; once a day is plenty. */
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
/** Long enough after launch that starting up is never competing with a download. */
const FIRST_CHECK_MS = 60 * 1000;

let wiredUp = false;
let readyVersion = null;

function initUpdates({ onQuitRequested }) {
  const auto = updater();
  if (!auto) return;
  if (wiredUp) return;
  wiredUp = true;

  auto.autoDownload = true;
  // Nothing installs behind the user's back — not on quit, not ever without a yes.
  auto.autoInstallOnAppQuit = false;
  auto.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };

  auto.on('error', (err) => console.error(`updates: ${err?.message ?? err}`));

  auto.on('update-downloaded', async (info) => {
    readyVersion = info?.version ?? null;
    if (Notification.isSupported()) {
      new Notification({
        title: 'VGPT.IL',
        body: `גרסה ${readyVersion} מוכנה להתקנה.`,
        icon: path.join(__dirname, 'icon.png'),
      }).show();
    }
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['התקנה והפעלה מחדש', 'בפעם הבאה'],
      defaultId: 0,
      cancelId: 1,
      title: 'VGPT.IL',
      message: `גרסה ${readyVersion} הורדה ומוכנה.`,
      detail:
        'ההתקנה סוגרת את האפליקציה לרגע ומפעילה אותה מחדש. ' +
        'אפשר גם לדחות — הגרסה כבר על המחשב ותותקן בפעם הבאה שתבחרו.',
    });
    if (response === 0) {
      onQuitRequested?.();
      // isSilent=false so the installer is visible; isForceRunAfter so the tray
      // process comes back by itself — otherwise "restart" silently means "quit".
      auto.quitAndInstall(false, true);
    }
  });

  setTimeout(() => void check(false), FIRST_CHECK_MS);
  const timer = setInterval(() => void check(false), CHECK_EVERY_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

/**
 * @param {boolean} interactive true when a person asked, in which case they get
 * an answer either way. A background check that found nothing says nothing.
 */
async function check(interactive) {
  const auto = updater();
  if (!auto) {
    if (interactive) {
      dialog.showMessageBox({
        type: 'info',
        title: 'VGPT.IL',
        message: 'בדיקת עדכונים זמינה רק בגרסה המותקנת.',
        detail: 'הגרסה הזו רצה מקוד המקור, ומתעדכנת דרך git.',
      });
    }
    return;
  }
  if (readyVersion && interactive) {
    dialog.showMessageBox({
      type: 'info',
      title: 'VGPT.IL',
      message: `גרסה ${readyVersion} כבר הורדה.`,
      detail: 'היא תותקן כשתאשרו — ההודעה תופיע שוב, או שאפשר לצאת ולהיכנס מחדש.',
    });
    return;
  }
  try {
    const result = await auto.checkForUpdates();
    const found = result?.updateInfo?.version;
    if (!interactive) return;
    if (found && found !== app.getVersion()) {
      dialog.showMessageBox({
        type: 'info',
        title: 'VGPT.IL',
        message: `נמצאה גרסה ${found}.`,
        detail: 'היא יורדת ברקע. תופיע הודעה כשאפשר להתקין.',
      });
    } else {
      dialog.showMessageBox({
        type: 'info',
        title: 'VGPT.IL',
        message: `הגרסה שלכם (${app.getVersion()}) היא העדכנית ביותר.`,
      });
    }
  } catch (err) {
    console.error(`updates: check failed — ${err?.message ?? err}`);
    if (interactive) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'VGPT.IL',
        message: 'לא הצלחנו לבדוק אם יש עדכון.',
        detail: String(err?.message ?? err),
      });
    }
  }
}

module.exports = { initUpdates, checkForUpdates: check, showPatchNotes, showPatchNotesIfUpdated };
