import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { OwnedGame } from './steamLibrary.ts';

/**
 * What you play on Steam, read from the Steam already installed on this machine.
 *
 * WHY THIS EXISTS. The Web API route (steamLibrary.ts) needs a key, and getting
 * one means filling in a form that demands a domain name — which stops people
 * who have no domain and no reason to think they are allowed to type one. That
 * is a heavy toll for a feature whose whole job is a taste guess.
 *
 * The Steam client has been writing the same numbers to disk all along.
 * `localconfig.vdf` holds, per app, `Playtime` in minutes, `Playtime2wks`, and
 * `LastPlayed` — exactly the fields the advisor consumes. No key, no network
 * request, no login, no profile privacy setting to get wrong. Measured on a
 * real install: 315 apps with playtime recorded.
 *
 * WHAT IT IS NOT. This is not the owned library. It is what has been PLAYED on
 * this computer, which differs in two ways that matter:
 *
 *   - Games bought and never installed here are absent. For taste profiling
 *     that is no loss — the advisor already discards anything under two hours,
 *     so an unplayed game contributes nothing either way. It IS a loss for the
 *     "you already own this" exclusion, which can now miss a game and suggest
 *     something the person owns. Callers get `partial: true` so they can say so
 *     rather than quietly being wrong.
 *   - A second PC, or a reinstall that wiped userdata, means fewer records.
 *
 * So this is the no-key default and the API key stays as the way to get the
 * complete library. Neither replaces the other.
 *
 * PRIVACY. Everything here is read-only, local, and never leaves the machine.
 * The only field taken beyond playtime is the account id, and only to find the
 * right userdata folder when several accounts have signed in on one PC.
 */

/** Minutes below which an entry is a tool or a mis-launch, not a played game. */
const NOISE_MINUTES = 5;

/** Steam's own install locations, most likely first. */
function steamRoots(): string[] {
  const roots: string[] = [];
  const env = process.env.VGPT_STEAM_PATH?.trim();
  if (env) roots.push(env);
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]) {
      if (base) roots.push(path.join(base, 'Steam'));
    }
  } else if (process.platform === 'darwin') {
    roots.push(path.join(os.homedir(), 'Library', 'Application Support', 'Steam'));
  } else {
    // Native, Flatpak and Snap each keep the same layout under their own root,
    // so listing the roots is the whole difference between them.
    roots.push(path.join(os.homedir(), '.steam', 'steam'));
    roots.push(path.join(os.homedir(), '.local', 'share', 'Steam'));
    roots.push(path.join(os.homedir(), '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'));
  }
  return roots;
}

/** The Steam install to read, or null if this machine has none. */
export function findSteam(): string | null {
  for (const root of steamRoots()) {
    try {
      if (fs.statSync(path.join(root, 'userdata')).isDirectory()) return root;
    } catch {
      // Not here — try the next.
    }
  }
  return null;
}

/**
 * A Valve KeyValues (.vdf/.acf) text file, as nested plain objects.
 *
 * Written out rather than pulled from a package because the format is small and
 * this reads files inside the user's Steam install: a dependency here would be
 * one more thing to trust with that. The grammar is genuinely just quoted
 * tokens and braces.
 *
 * Handled deliberately:
 *   - backslash escapes inside quoted strings, which appear in LaunchOptions;
 *   - line comments, which Valve writes into some files;
 *   - unquoted tokens, which appear in older files.
 * Not handled, because Valve does not put them in these files: #include and
 * platform-conditional key suffixes. An unparseable file yields {} rather than
 * throwing, since a taste guess is never worth failing a request over.
 */
export function parseVdf(text: string): Record<string, unknown> {
  let i = 0;
  const n = text.length;

  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      return;
    }
  };

  const token = (): string | null => {
    skip();
    if (i >= n) return null;
    const c = text[i];
    if (c === '{' || c === '}') {
      i++;
      return c;
    }
    if (c === '"') {
      i++;
      let out = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const esc = text[i + 1];
          out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          i += 2;
          continue;
        }
        out += text[i++];
      }
      i++; // closing quote
      return out;
    }
    let out = '';
    while (i < n && !/[\s{}"]/.test(text[i])) out += text[i++];
    return out;
  };

  /** Pairs until '}' or the end. A '{' where a value belongs opens a child. */
  const block = (): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    for (;;) {
      const key = token();
      if (key === null || key === '}') return obj;
      if (key === '{') continue; // stray open brace — skip rather than derail
      const value = token();
      if (value === null) return obj;
      obj[key] = value === '{' ? block() : value;
    }
  };

  try {
    return block();
  } catch {
    return {};
  }
}

function readVdf(file: string): Record<string, unknown> {
  try {
    return parseVdf(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Case-insensitive lookup — Valve is not consistent about key casing across files. */
function pick(obj: Record<string, unknown>, name: string): unknown {
  const hit = Object.keys(obj).find((k) => k.toLowerCase() === name.toLowerCase());
  return hit === undefined ? undefined : obj[hit];
}

/** Walk to a nested object by case-insensitive path, or null. */
function descend(obj: Record<string, unknown>, ...names: string[]): Record<string, unknown> | null {
  let cur: Record<string, unknown> = obj;
  for (const name of names) {
    const next = pick(cur, name);
    if (!isObj(next)) return null;
    cur = next;
  }
  return cur;
}

export interface LocalAccount {
  /** The userdata folder name — Steam's 32-bit account id. */
  accountId: string;
  /** The 64-bit id the Web API uses, derived from it. */
  steamId64: string;
  personaName?: string;
  /** When Steam last recorded a login for this account, epoch seconds. */
  lastLogin: number;
}

/** SteamID64 = the 32-bit account id plus Valve's fixed individual-account base. */
const STEAM64_BASE = 76561197960265728n;

/**
 * Accounts that have signed in on this machine, most recently used first.
 *
 * A shared family PC genuinely has several, and picking the wrong one produces
 * a confidently wrong taste profile. Most recent first is the good default; the
 * caller can still offer the list.
 */
export function localAccounts(root: string): LocalAccount[] {
  const found = new Map<string, LocalAccount>();

  // loginusers.vdf gives names and timestamps, keyed by the 64-bit id.
  const users = descend(readVdf(path.join(root, 'config', 'loginusers.vdf')), 'users');
  for (const [id64, info] of Object.entries(users ?? {})) {
    if (!isObj(info) || !/^\d{17}$/.test(id64)) continue;
    const accountId = String(BigInt(id64) - STEAM64_BASE);
    const persona = pick(info, 'PersonaName');
    found.set(accountId, {
      accountId,
      steamId64: id64,
      personaName: typeof persona === 'string' ? persona : undefined,
      lastLogin: Number(pick(info, 'Timestamp')) || 0,
    });
  }

  // The userdata folders are the ground truth for what is actually readable —
  // an account can be listed in loginusers.vdf with its data long since gone,
  // and can have data after a config reset dropped it from the list.
  let dirs: string[] = [];
  try {
    dirs = fs
      .readdirSync(path.join(root, 'userdata'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name) && e.name !== '0')
      .map((e) => e.name);
  } catch {
    return [];
  }

  const out: LocalAccount[] = [];
  for (const accountId of dirs) {
    const known = found.get(accountId);
    out.push(
      known ?? {
        accountId,
        steamId64: String(BigInt(accountId) + STEAM64_BASE),
        lastLogin: 0,
      }
    );
  }
  return out.sort((a, b) => b.lastLogin - a.lastLogin);
}

/** Titles for installed games, from the app manifests across every library folder. */
function installedTitles(root: string): Map<string, string> {
  const titles = new Map<string, string>();
  const folders = new Set<string>([root]);

  const libraries = descend(readVdf(path.join(root, 'steamapps', 'libraryfolders.vdf')), 'libraryfolders');
  for (const entry of Object.values(libraries ?? {})) {
    // Current files nest a path inside a per-library object; very old ones map
    // the index straight to a path string.
    if (isObj(entry)) {
      const p = pick(entry, 'path');
      if (typeof p === 'string') folders.add(p);
    } else if (typeof entry === 'string') {
      folders.add(entry);
    }
  }

  for (const folder of folders) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(path.join(folder, 'steamapps')).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      continue; // a drive that is not mounted any more
    }
    for (const file of files) {
      const state = descend(readVdf(path.join(folder, 'steamapps', file)), 'AppState');
      if (!state) continue;
      const appId = pick(state, 'appid');
      const name = pick(state, 'name');
      if (typeof appId === 'string' && typeof name === 'string') titles.set(appId, name);
    }
  }
  return titles;
}

export interface LocalLibrary {
  games: OwnedGame[];
  account: LocalAccount;
  /**
   * Always true, and named rather than implied: this is what was played here,
   * not everything owned. The UI must say so — see the note at the top.
   */
  partial: true;
}

/**
 * Playtime for one account on this machine.
 *
 * Titles are filled in only for games still installed; everything else keeps an
 * empty title, because the caller already looks each sampled app up in Steam's
 * store API for its genres and gets the name from the same response. Guessing a
 * title here would be a second source of truth for no gain.
 */
export function localLibrary(root: string, account: LocalAccount): LocalLibrary {
  const config = readVdf(path.join(root, 'userdata', account.accountId, 'config', 'localconfig.vdf'));
  const apps = descend(config, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps');
  const titles = installedTitles(root);
  const games: OwnedGame[] = [];

  for (const [appId, entry] of Object.entries(apps ?? {})) {
    if (!isObj(entry) || !/^\d+$/.test(appId)) continue;
    const minutes = Number(pick(entry, 'Playtime')) || 0;
    // Entries with only a `cloud` block and no Playtime are tools and runtimes
    // (Steamworks Common Redistributables, the screenshot uploader), not games.
    if (minutes < NOISE_MINUTES) continue;
    games.push({
      appId,
      title: titles.get(appId) ?? '',
      minutes,
      recentMinutes: Number(pick(entry, 'Playtime2wks')) || 0,
    });
  }

  games.sort((a, b) => b.minutes - a.minutes);
  return { games, account, partial: true };
}

/**
 * The best local library this machine can offer, or null if it has none.
 *
 * Null is an ordinary answer, not a failure: plenty of people run this on a
 * machine with no Steam client at all, and the caller falls back to the Web API
 * key without anything having gone wrong.
 */
export function localLibraryHere(accountId?: string): LocalLibrary | null {
  const root = findSteam();
  if (!root) return null;
  const accounts = localAccounts(root);
  if (accounts.length === 0) return null;
  const account = (accountId && accounts.find((a) => a.accountId === accountId)) || accounts[0];
  const lib = localLibrary(root, account);
  return lib.games.length > 0 ? lib : null;
}
