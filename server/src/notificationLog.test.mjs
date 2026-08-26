import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The bell and the log are two views of one list, and only one of them destroys.
 *
 * Reported: clearing a God of War alert from the bell also erased it from the
 * Settings log. Clearing the bell used to be a DELETE, so tidying it threw away
 * the only record that a price had ever moved — which is the one thing the log
 * exists to keep.
 */

let n = 0;
async function freshDb() {
  process.env.VGPT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vgpt-log-'));
  return import(`./db.ts?case=${n++}`);
}

function seed(db, titles) {
  const row = db.addToWishlist({ title: 'A Game', platform: 'pc', refs: [{ sourceId: 's', sourceGameId: '1' }] });
  for (const title of titles) {
    db.addNotification({ wishlistId: row.id, title, message: 'price moved', priceILS: 10, kind: 'drop' });
  }
  return row;
}

test('clearing the bell empties the bell', async () => {
  const db = await freshDb();
  seed(db, ['God of War Ragnarok', 'Elden Ring']);
  assert.equal(db.listNotifications().length, 2);

  db.clearNotifications();
  assert.equal(db.listNotifications().length, 0, 'the bell should be empty');
  assert.equal(db.unreadNotificationCount(), 0, 'and carry no unread badge');
});

test('…but the log still has every one of them', async () => {
  const db = await freshDb();
  seed(db, ['God of War Ragnarok', 'Elden Ring']);
  db.clearNotifications();

  const log = db.listAllNotifications();
  assert.equal(log.length, 2, 'the log is the durable copy');
  assert.deepEqual(
    log.map((r) => r.title).sort(),
    ['Elden Ring', 'God of War Ragnarok']
  );
});

test('a new alert after a bell clear returns to the bell', async () => {
  const db = await freshDb();
  const row = seed(db, ['Old One']);
  db.clearNotifications();
  db.addNotification({ wishlistId: row.id, title: 'Fresh One', message: 'dropped', priceILS: 9, kind: 'drop' });

  assert.deepEqual(db.listNotifications().map((r) => r.title), ['Fresh One']);
  assert.equal(db.unreadNotificationCount(), 1);
  assert.equal(db.listAllNotifications().length, 2, 'and the log has both');
});

test('purging the log is the only thing that destroys the record', async () => {
  const db = await freshDb();
  seed(db, ['God of War Ragnarok']);
  db.purgeNotifications();
  assert.equal(db.listAllNotifications().length, 0);
  assert.equal(db.listNotifications().length, 0);
});

test('an older database gains the column without losing its alerts', async () => {
  // The bell/log split adds a column. A database written before it must come
  // through with its history intact, not be reset by the migration.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vgpt-log-mig-'));
  process.env.VGPT_DATA_DIR = dir;
  const first = await import(`./db.ts?case=${n++}`);
  seed(first, ['Kept Through Upgrade']);

  // Re-open the same file as a separate module instance, as a restart would.
  process.env.VGPT_DATA_DIR = dir;
  const again = await import(`./db.ts?case=${n++}`);
  assert.equal(again.listAllNotifications().length, 1);
  assert.equal(again.listAllNotifications()[0].title, 'Kept Through Upgrade');
  assert.equal(again.listNotifications().length, 1, 'and it is still in the bell');
});
