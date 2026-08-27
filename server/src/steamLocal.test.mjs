import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseVdf, localAccounts, localLibrary } from './steamLocal.ts';

/**
 * The Steam client's own files, parsed.
 *
 * This reads inside somebody's Steam install, so the failure mode that matters
 * is not a crash — it is a parse that half-works and produces a taste profile
 * built on the wrong numbers, which looks exactly like a bad recommender. The
 * cases below are the shapes Valve actually writes.
 */

/* ── The KeyValues format ────────────────────────────────────────────────── */

test('nested blocks become nested objects', () => {
  const vdf = `
"UserLocalConfigStore"
{
  "Software"
  {
    "Valve"
    {
      "Steam"
      {
        "apps"
        {
          "440"
          {
            "LastPlayed"  "1786497511"
            "Playtime"    "314991"
          }
        }
      }
    }
  }
}`;
  const got = parseVdf(vdf);
  assert.equal(got.UserLocalConfigStore.Software.Valve.Steam.apps['440'].Playtime, '314991');
});

test('a value containing an escaped quote does not end the string early', () => {
  // LaunchOptions is where this lives, and it sits in the same app block as
  // Playtime — so getting it wrong shifts every following key by one and the
  // playtime read after it belongs to a different game.
  const got = parseVdf('"apps" { "10" { "LaunchOptions" "-name \\"my server\\"" "Playtime" "42" } }');
  assert.equal(got.apps['10'].LaunchOptions, '-name "my server"');
  assert.equal(got.apps['10'].Playtime, '42');
});

test('a Windows path keeps its backslashes', () => {
  // "C:\\Program Files (x86)\\Steam" in the file is one escaped backslash each.
  const got = parseVdf('"libraryfolders" { "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" } }');
  assert.equal(got.libraryfolders['0'].path, 'C:\\Program Files (x86)\\Steam');
});

test('line comments are skipped', () => {
  const got = parseVdf('// a comment\n"a" { // another\n "b" "1" }');
  assert.equal(got.a.b, '1');
});

test('unquoted tokens still parse', () => {
  const got = parseVdf('AppState { appid 440 name TeamFortress }');
  assert.equal(got.AppState.appid, '440');
});

test('a truncated file yields what it had rather than throwing', () => {
  // Steam writes these live; reading one mid-write is a real possibility and
  // must degrade to "fewer games" rather than to a failed request.
  const got = parseVdf('"apps" { "440" { "Playtime" "100" } "570" { "Playtime"');
  assert.equal(got.apps['440'].Playtime, '100');
});

test('junk is an empty object, not an exception', () => {
  assert.deepEqual(parseVdf('}}}}'), {});
  assert.deepEqual(parseVdf(''), {});
});

/* ── Reading a real install layout ───────────────────────────────────────── */

/** A minimal but faithful Steam tree in a temp dir. */
function fakeSteam() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vgpt-steam-'));
  const write = (rel, body) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };

  write(
    'config/loginusers.vdf',
    `"users"
{
  "76561198051685274"
  {
    "AccountName"  "someone"
    "PersonaName"  "Player One"
    "Timestamp"    "1787826025"
  }
  "76561198000000001"
  {
    "PersonaName"  "Older Account"
    "Timestamp"    "1500000000"
  }
}`
  );

  write(
    'userdata/91419546/config/localconfig.vdf',
    `"UserLocalConfigStore"
{
  "Software" { "Valve" { "Steam" { "apps"
  {
    "228980" { "cloud" { "last_sync_state" "synchronized" } }
    "440"    { "LastPlayed" "1786497511" "Playtime" "314991" "Playtime2wks" "120" }
    "1091500"{ "LastPlayed" "1700000000" "Playtime" "9801" }
    "215"    { "LastPlayed" "1405501947" "Playtime" "1" }
  } } } }
}`
  );
  // The second account exists in loginusers but has no userdata folder.

  write('steamapps/libraryfolders.vdf', `"libraryfolders" { "0" { "path" "${root.replace(/\\/g, '\\\\')}" } }`);
  write('steamapps/appmanifest_440.acf', '"AppState" { "appid" "440" "name" "Team Fortress 2" }');
  return root;
}

test('accounts come from the userdata folders, named from loginusers', () => {
  const root = fakeSteam();
  const accounts = localAccounts(root);
  // Only one has a userdata folder; an account listed with no data is not one
  // this machine can actually profile.
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].accountId, '91419546');
  assert.equal(accounts[0].personaName, 'Player One');
});

test('the 64-bit id is derived correctly from the folder name', () => {
  // Off by one here silently profiles a stranger.
  const root = fakeSteam();
  assert.equal(localAccounts(root)[0].steamId64, '76561198051685274');
});

test('playtime is read, and entries that are not played games are dropped', () => {
  const root = fakeSteam();
  const lib = localLibrary(root, localAccounts(root)[0]);
  const ids = lib.games.map((g) => g.appId);
  assert.deepEqual(ids, ['440', '1091500'], 'sorted by playtime, noise removed');
  // 228980 is Steamworks Common Redistributables — a cloud block, no Playtime.
  assert.ok(!ids.includes('228980'), 'a runtime is not a game');
  // 215 is Source SDK Base with one minute: a mis-launch, not an opinion.
  assert.ok(!ids.includes('215'), 'one minute is noise');
});

test('minutes and the fortnight figure survive the trip', () => {
  const root = fakeSteam();
  const tf2 = localLibrary(root, localAccounts(root)[0]).games.find((g) => g.appId === '440');
  assert.equal(tf2.minutes, 314991);
  assert.equal(tf2.recentMinutes, 120);
});

test('an installed game gets its title; an uninstalled one is left blank', () => {
  // Blank is deliberate — the advisor looks each sampled app up in the store
  // anyway and gets the name from that. A guess here would be a second source
  // of truth for the same field.
  const root = fakeSteam();
  const games = localLibrary(root, localAccounts(root)[0]).games;
  assert.equal(games.find((g) => g.appId === '440').title, 'Team Fortress 2');
  assert.equal(games.find((g) => g.appId === '1091500').title, '');
});

test('the result is always marked partial', () => {
  // Played-on-this-PC is not owned, and the caller must be able to say so.
  const root = fakeSteam();
  assert.equal(localLibrary(root, localAccounts(root)[0]).partial, true);
});

test('a library folder on a drive that is gone does not lose the rest', () => {
  const root = fakeSteam();
  fs.writeFileSync(
    path.join(root, 'steamapps', 'libraryfolders.vdf'),
    `"libraryfolders" { "0" { "path" "Z:\\\\NotMounted" } "1" { "path" "${root.replace(/\\/g, '\\\\')}" } }`
  );
  const games = localLibrary(root, localAccounts(root)[0]).games;
  assert.equal(games.find((g) => g.appId === '440').title, 'Team Fortress 2');
});

test('a machine with no Steam at all reports no accounts rather than throwing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'vgpt-nosteam-'));
  assert.deepEqual(localAccounts(empty), []);
});
