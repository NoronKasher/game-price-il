const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');

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
    server: path.join(base, 'server', 'dist', 'index.js'),
    web: path.join(base, 'web', 'dist'),
  };
}

let serverProcess = null;
let tray = null;
let win = null;
let quitting = false;

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
      VGPT_WEB_DIR: web,
      // Price history belongs to the person, in the place their OS keeps such
      // things — not next to the application, where an update could remove it.
      VGPT_DATA_DIR: path.join(app.getPath('userData'), 'data'),
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
  });

  // Store links belong in the user's real browser, with their sessions and
  // payment details — never in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray(port) {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('VGPT.IL — משווה מחירי משחקים');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'פתיחת החלון', click: () => (win ? win.show() : createWindow(port)) },
      { label: 'פתיחה בדפדפן', click: () => shell.openExternal(`http://127.0.0.1:${port}`) },
      { type: 'separator' },
      {
        label: 'יציאה (מפסיק גם את מעקב המחירים)',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('double-click', () => (win ? win.show() : createWindow(port)));
}

// One instance only: two copies would mean two schedulers writing the same
// database, and two sets of requests going to the same shops.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
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
      console.log(up ? `SMOKE OK: server answered on ${port}` : 'SMOKE FAIL: server never answered');
      quitting = true;
      serverProcess?.kill();
      app.exit(up ? 0 : 1);
      return;
    }
    if (!up) {
      dialog.showErrorBox('VGPT.IL', 'השרת המקומי לא עלה. נסו להפעיל שוב.');
      app.exit(1);
      return;
    }
    createWindow(port);
    createTray(port);
  });

  // Hiding the window is not quitting; the tray is the only way out.
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    quitting = true;
    serverProcess?.kill();
  });
}
