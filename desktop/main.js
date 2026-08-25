const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, Notification } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { discoverPsnHash } = require('./psnHash.js');
const { initUpdates, checkForUpdates, showPatchNotes, showPatchNotesIfUpdated } = require('./updates.js');
const backup = require('./backup.js');

/**
 * VGPT.IL as a desktop application.
 *
 * The extension is the main way to use this tool, and for most people it is the
 * better one — nothing to install beyond a browser, and each person's own
 * address doing their own small amount of scraping. This exists for the one
 * thing an extension genuinely cannot do: keep recording prices while the
 * browser is closed. MV3 kills its service worker within seconds of going idle
 * and `chrome.alarms` only fire while Chrome is running, so a tracking list that
 * should check in every week depends on the browser being open when it does.
 * A desktop process does not have that problem.
 *
 * So this is a background service with a window attached, not the other way
 * round: closing the window hides it and capture carries on; quitting is a
 * deliberate act from the tray.
 *
 * The server runs as a child process using Electron's own bundled Node
 * (ELECTRON_RUN_AS_NODE), so the app never needs Node installed on the machine.
 */

const isSmoke = process.argv.includes('--smoke');
/** Force one PlayStation hash discovery and print the result — for verifying a build. */
const isPsnProbe = process.argv.includes('--psn-hash');

// Set before anything reads getPath('userData'): that path is derived from the
// app name, and unset it defaults to "Electron" — which would put one person's
// price history in a folder shared with every other unpackaged Electron app.
app.setName('VGPT.IL');

/** Ask the OS for a port nobody is using, so a dev server can never collide. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Where the bundled server and the built UI live, packaged or from source. */
function paths() {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  return {
    server: path.join(base, 'server', 'dist', 'index.mjs'),
    web: path.join(base, 'web', 'dist'),
  };
}

/**
 * Where the price database lives.
 *
 * Price history belongs to the person, in the place their OS keeps such things —
 * not next to the application, where an update could remove it. The smoke check
 * gets a scratch directory instead: it exports and re-imports as part of the
 * test, and a build check has no business writing to somebody's real history.
 */
function dataDir() {
  return isSmoke
    ? path.join(app.getPath('temp'), 'vgpt-smoke-data')
    : path.join(app.getPath('userData'), 'data');
}

let serverProcess = null;
let tray = null;
let win = null;
let quitting = false;
let toldAboutTray = false;

function startServer(port) {
  const { server, web } = paths();
  if (!fs.existsSync(server)) {
    throw new Error(`server bundle missing at ${server} — run "npm run build:desktop" first`);
  }
  serverProcess = spawn(process.execPath, [server], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      VGPT_PORT: String(port),
      // Tells the server which shell it is inside, so Settings can report that
      // PlayStation recovery works here via the app's own Chromium rather than
      // claiming no browser was found.
      VGPT_HOST: 'desktop',
      VGPT_WEB_DIR: web,
      VGPT_DATA_DIR: dataDir(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (!quitting) console.error(`[server] exited unexpectedly (${code})`);
  });
}

/** Resolve once the server answers, so the window never shows a connection error. */
async function waitForServer(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

function createWindow(port) {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    backgroundColor: '#0d1117',
    title: 'VGPT.IL',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.loadURL(`http://127.0.0.1:${port}`);

  // Closing the window must not stop price capture — that is the whole reason
  // to run this instead of the extension. Hide instead, and let the tray quit.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    // Say so the first time. An app that keeps running after you closed its
    // window is a reasonable design and an unpleasant surprise; it should only
    // ever be the first one.
    if (!toldAboutTray && Notification.isSupported()) {
      toldAboutTray = true;
      new Notification({
        title: 'VGPT.IL',
        body: 'המעקב אחרי המחירים ממשיך לרוץ ברקע. ליציאה מלאה — לחצו ימני על הסמל שליד השעון.',
        icon: path.join(__dirname, 'icon.png'),
      }).show();
    }
  });

  // Store links belong in the user's real browser, with their sessions and
  // payment details — never in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Here rather than at startup, because the usual way this app starts is at
  // login with no window at all. Tying the notes to a window means someone whose
  // machine updated overnight meets them when they next sit down — not behind
  // everything else on a desktop they were not looking at.
  showPatchNotesIfUpdated();
}

/**
 * Keep PlayStation working when Sony rotates its persisted-query hash.
 *
 * The server reports `needsRecovery` once a live PSN call has actually been
 * refused — it never guesses, and this never touches the store on a timer. All
 * that runs on a schedule is a localhost question, which costs nothing and
 * reaches nobody. When the answer is yes, we are a Chromium, so we go and get
 * the hash ourselves and hand it back.
 *
 * Without this the desktop build is the one shape of the tool that cannot heal
 * itself: its server is bundled into a single file and cannot carry the
 * playwright dependency the source build uses for the same job.
 */
const PSN_WATCH_MS = 5 * 60 * 1000;

async function recoverPsnHashIfNeeded(port) {
  let status;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/psn-hash`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    status = await res.json();
  } catch {
    return; // server restarting, or gone; the next tick asks again
  }
  if (!status?.needsRecovery) return;

  console.log('psn: the store refused our search hash — recovering it with the app browser');
  const hash = await discoverPsnHash();
  if (!hash) {
    console.log('psn: could not read a fresh hash from the store page');
    return;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/psn-hash`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash }),
      signal: AbortSignal.timeout(5000),
    });
    console.log(res.ok ? `psn: recovered and saved a fresh hash (${hash.slice(0, 12)}…)` : 'psn: the server rejected the recovered hash');
  } catch (err) {
    console.log(`psn: could not save the recovered hash — ${err.message}`);
  }
}

function watchPsnHash(port) {
  const timer = setInterval(() => void recoverPsnHashIfNeeded(port), PSN_WATCH_MS);
  // Never hold the process open on our account; quitting is the tray's decision.
  if (typeof timer.unref === 'function') timer.unref();
}

/** dd.mm, hh:mm — enough to tell "this morning" from "three weeks ago" at a glance. */
function shortWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Rebuilt rather than built once: several of these items report state (where
 * backups go, when the last one ran), and a menu that shows yesterday's answer
 * is worse than one that shows none.
 */
function trayMenu(port) {
  const b = backup.loadSettings();
  const backupStatus = !b.folder
    ? 'לא הוגדר יעד גיבוי'
    : b.lastError
      ? `הגיבוי האחרון נכשל: ${b.lastError}`
      : b.lastAt
        ? `גובה לאחרונה ${shortWhen(b.lastAt)}`
        : 'טרם גובה';

  return Menu.buildFromTemplate([
    { label: 'פתיחת החלון', click: () => (win ? win.show() : createWindow(port)) },
    { label: 'פתיחה בדפדפן', click: () => shell.openExternal(`http://127.0.0.1:${port}`) },
    { type: 'separator' },
    { label: 'מה חדש', click: () => showPatchNotes() },
    { label: 'בדיקת עדכון', click: () => void checkForUpdates(true) },
    { type: 'separator' },
    {
      // History is the one thing here that cannot be re-fetched from the shops.
      label: 'גיבוי היסטוריית המחירים',
      submenu: [
        { label: backupStatus, enabled: false },
        { type: 'separator' },
        {
          label: b.folder ? 'שינוי תיקיית הגיבוי…' : 'בחירת תיקיית גיבוי…',
          click: async () => {
            await backup.chooseFolder(port);
            refreshTray(port);
          },
        },
        {
          label: 'גיבוי עכשיו',
          click: async () => {
            await backup.backupNow(port, true);
            refreshTray(port);
          },
        },
        { label: 'פתיחת תיקיית הגיבוי', enabled: !!b.folder, click: () => backup.openFolder() },
        { type: 'separator' },
        {
          label: 'גיבוי אוטומטי יומי',
          type: 'checkbox',
          checked: b.auto,
          click: (item) => {
            backup.saveSettings({ ...backup.loadSettings(), auto: item.checked });
            refreshTray(port);
          },
        },
        { type: 'separator' },
        {
          // The other half of the point: a new machine.
          label: 'שחזור מקובץ גיבוי…',
          click: async () => {
            await backup.restore(port);
            refreshTray(port);
          },
        },
      ],
    },
    { type: 'separator' },
    {
      // Price history is only as good as how often it is taken; a tracker that
      // only runs when someone remembers to open it records gaps.
      label: 'הפעלה אוטומטית עם הדלקת המחשב',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
    },
    { type: 'separator' },
    {
      label: 'יציאה (מפסיק גם את מעקב המחירים)',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function refreshTray(port) {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(trayMenu(port));
}

function createTray(port) {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('VGPT.IL — משווה מחירי משחקים');
  tray.setContextMenu(trayMenu(port));
  tray.on('double-click', () => (win ? win.show() : createWindow(port)));
}

/**
 * Report a smoke result.
 *
 * Electron is a Windows GUI-subsystem binary, so its console.log never reaches
 * a pipe or a redirect — a smoke test you cannot read is a smoke test you end up
 * trusting on an exit code alone. VGPT_SMOKE_LOG names a file to write to
 * instead, which is also what makes this checkable in CI.
 */
function say(line) {
  console.log(line);
  const file = process.env.VGPT_SMOKE_LOG;
  if (!file) return;
  try {
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    /* the check itself must never fail on its own bookkeeping */
  }
}

/**
 * A tracked game with two days of history, invented here.
 *
 * The smoke check runs against a scratch database, so without this it would
 * export nothing and prove nothing — "0 games backed up and 0 restored" passes
 * whether the feature works or not. Seeding offline keeps the check meaningful
 * and still touches no store: the import route accepts a file, so this is the
 * same path a restore takes.
 */
function smokeSeed() {
  const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  return {
    version: 1,
    items: [
      {
        title: 'Smoke Test Game',
        platform: 'pc',
        image: null,
        refs: [{ sourceId: 'steam-regional', sourceGameId: '999999' }],
        preferred_region: 'IL',
        hide_desc: 0,
        added_at: day(30),
        history: [
          { store: 'Steam', region: 'IL', kind: 'digital', price: 199, currency: 'ILS', price_ils: 199, checked_at: day(7) },
          { store: 'Steam', region: 'IL', kind: 'digital', price: 149, currency: 'ILS', price_ils: 149, checked_at: day(1) },
        ],
      },
    ],
  };
}

const postJson = (port, route, body) =>
  fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

/** Backup → restore, end to end, into a throwaway folder. Prints what it found. */
async function smokeBackup(port) {
  const dir = path.join(app.getPath('temp'), 'vgpt-smoke-backup');
  try {
    const seeded = await postJson(port, '/api/import', smokeSeed());
    if (!seeded.ok) throw new Error(`could not seed the scratch database (${seeded.status})`);
    const { games: seedGames, points: seedPoints } = await seeded.json();

    const file = await backup.writeBackup(port, dir);
    const bytes = fs.statSync(file).size;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const games = (parsed.items ?? []).length;
    const points = (parsed.items ?? []).reduce((n, i) => n + (i.history ?? []).length, 0);
    if (games < 1 || points < 1) throw new Error('the backup came back without the seeded game');

    const res = await postJson(port, '/api/import', parsed);
    if (!res.ok) throw new Error(`import refused (${res.status})`);
    const merged = await res.json();
    // Re-importing what we just exported must add NOTHING. That de-duplication
    // is the whole reason restoring onto a machine that already has data is
    // safe, and it is the one property a user can never check for themselves.
    if (merged.games !== 0 || merged.points !== 0) {
      throw new Error(`restoring the same file twice duplicated data (+${merged.games} games, +${merged.points} points)`);
    }
    say(
      `SMOKE OK: seeded ${seedGames} game(s)/${seedPoints} point(s); ` +
        `backup ${bytes} bytes holds ${games} game(s)/${points} point(s); re-import added nothing`
    );
    return true;
  } catch (err) {
    say(`SMOKE FAIL: backup round-trip — ${err.message}`);
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * One instance only — except for the build checks.
 *
 * Two copies of the app would mean two schedulers writing the same database and
 * two sets of requests going to the same shops, so a second launch bows out.
 * But `--smoke` and `--psn-hash` were taking that same exit: with the installed
 * app running, every check quit immediately and EXITED ZERO, which is the worst
 * possible failure — a test that reports success by not running. They take no
 * lock, and smoke works in a throwaway data directory so it can never touch
 * somebody's real price history.
 */
const isCheck = isSmoke || isPsnProbe;

if (!isCheck && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // A build check that needs no server and no screen: can this machine's own
    // Chromium read the hash off the store page?
    if (isPsnProbe) {
      const hash = await discoverPsnHash();
      say(hash ? `PSN HASH OK: ${hash}` : 'PSN HASH FAIL: no hash seen');
      quitting = true;
      app.exit(hash ? 0 : 1);
      return;
    }

    let port;
    try {
      port = await freePort();
      startServer(port);
    } catch (err) {
      if (isSmoke) {
        console.error(`SMOKE FAIL: ${err.message}`);
        app.exit(1);
        return;
      }
      dialog.showErrorBox('VGPT.IL', String(err.message));
      app.exit(1);
      return;
    }

    const up = await waitForServer(port);
    if (isSmoke) {
      // Headless check for CI and for verifying a build without a screen.
      say(up ? `SMOKE OK: server answered on ${port}` : 'SMOKE FAIL: server never answered');
      // The backup path has no UI in it — write a real one and read it straight
      // back in, so a broken export or a rejected import fails the build rather
      // than the first person who moves to a new machine.
      let backupOk = false;
      if (up) backupOk = await smokeBackup(port);
      quitting = true;
      serverProcess?.kill();
      app.exit(up && backupOk ? 0 : 1);
      return;
    }
    if (!up) {
      dialog.showErrorBox('VGPT.IL', 'השרת המקומי לא עלה. נסו להפעיל שוב.');
      app.exit(1);
      return;
    }
    createTray(port);
    watchPsnHash(port);
    backup.startBackups(port);
    initUpdates({
      onQuitRequested: () => {
        quitting = true;
        serverProcess?.kill();
      },
    });
    // Started by the OS at login: come up in the tray only. Nobody logging in
    // asked to be shown a price board.
    if (!process.argv.includes('--hidden')) createWindow(port);
  });

  // Hiding the window is not quitting; the tray is the only way out.
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    quitting = true;
    serverProcess?.kill();
  });
}
