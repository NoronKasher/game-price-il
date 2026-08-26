/**
 * Point every test at a throwaway database, before anything can open the real one.
 *
 * This exists because it already went wrong. extension/src/autoCapture.test.mjs
 * seeds fake games and calls evaluateAlerts, which reaches server/src/notify.ts →
 * db.ts. Inside the extension build db.ts is aliased to IndexedDB, but under Node
 * there is no alias, so it opened the REAL data/games.db — and since the fake
 * rows carried ids 1, 2, 3, it read the actual price history of whatever games
 * happened to hold those ids and wrote forty notifications titled "Due Game"
 * into a user's live bell.
 *
 * A per-file `process.env.VGPT_DATA_DIR = …` would have fixed that one file and
 * left the next one to rediscover the problem. Loaded with --import, this runs
 * before any test module is evaluated, so no test can reach real data by
 * accident regardless of what it imports.
 *
 * VGPT_DATA_DIR is still honoured when a test sets its own — several do.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.VGPT_DATA_DIR) {
  process.env.VGPT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vgpt-test-'));
}
