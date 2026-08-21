import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAdapter } from './health.ts';

/**
 * The canary's own behaviour, with fake adapters — no network.
 *
 * The state that matters here is 'empty'. A parser that stops matching doesn't
 * throw, it returns nothing, which on the board is indistinguishable from "this
 * game isn't sold here". If `empty` ever collapsed into `ok`, the canary would
 * cheerfully report a dead scraper as healthy, which is worse than having no
 * canary at all.
 */

const fake = (over = {}) => ({
  id: 'fake',
  name: 'Fake',
  nameHe: 'מקור בדיקה',
  platforms: ['pc'],
  enabled: true,
  async search() {
    return [{ sourceId: 'fake', sourceGameId: '1', title: 'X', groupKey: 'x', edition: null, platform: 'pc' }];
  },
  async getOffers() {
    return [];
  },
  ...over,
});

test('an adapter returning hits is ok', async () => {
  const r = await checkAdapter(fake());
  assert.equal(r.state, 'ok');
  assert.equal(r.count, 1);
});

test('an adapter returning nothing is "empty", never ok', async () => {
  const r = await checkAdapter(fake({ search: async () => [] }));
  assert.equal(r.state, 'empty');
  assert.equal(r.count, 0);
});

test('a throwing adapter is reported, not propagated', async () => {
  const r = await checkAdapter(
    fake({
      search: async () => {
        throw new Error('selector no longer matches');
      },
    })
  );
  assert.equal(r.state, 'error');
  assert.match(r.detail, /selector/);
});

test('a key-gated adapter reads as disabled, not broken', async () => {
  const r = await checkAdapter(fake({ enabled: false }));
  assert.equal(r.state, 'disabled');
});

test('the probe used is reported so a human can repeat it', async () => {
  const r = await checkAdapter(fake());
  assert.ok(r.probe.length > 0);
  const console_ = await checkAdapter(fake({ platforms: ['switch'] }));
  assert.notEqual(console_.probe, r.probe); // a console source is probed with a console game
});
