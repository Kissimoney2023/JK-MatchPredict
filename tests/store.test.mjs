import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryStore} from '../server/store/memory.mjs';
import {createRedisStore} from '../server/store/redis.mjs';

/** Minimal Redis stand-in: GET, SET (NX/EX) and the compare-and-set script used by the store. */
function fakeRedis() {
  const data = new Map();
  const ttls = new Map();
  return {
    ttls,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value, opts = {}) {
      if (opts.nx && data.has(key)) return null;
      data.set(key, value);
      if (opts.ex) ttls.set(key, opts.ex);
      return 'OK';
    },
    async eval(_script, [key], [etag, payload, ex]) {
      const cur = data.get(key);
      if (!cur || cur.slice(0, cur.indexOf('\n')) !== etag) return 0;
      data.set(key, payload);
      if (Number(ex) > 0) ttls.set(key, Number(ex));
      return 1;
    },
  };
}

for (const [name, make] of [
  ['memory', createMemoryStore],
  ['redis', () => createRedisStore(fakeRedis())],
]) {
  test(`${name} store: JSON round trip, onlyIfNew and onlyIfMatch`, async () => {
    const store = make();
    assert.equal(await store.get('k'), null);
    assert.equal(await store.getWithMetadata('k'), null);

    assert.deepEqual(await store.setJSON('k', {n: 1}, {onlyIfNew: true}), {modified: true});
    assert.deepEqual(await store.setJSON('k', {n: 2}, {onlyIfNew: true}), {modified: false});
    assert.deepEqual(await store.get('k', {type: 'json'}), {n: 1});

    const meta = await store.getWithMetadata('k', {type: 'json'});
    assert.deepEqual(meta.data, {n: 1});
    assert.deepEqual(await store.setJSON('k', {n: 2}, {onlyIfMatch: meta.etag}), {modified: true});
    // The old etag is now stale.
    assert.deepEqual(await store.setJSON('k', {n: 3}, {onlyIfMatch: meta.etag}), {modified: false});
    assert.deepEqual(await store.get('k'), {n: 2});
  });
}

test('redis store applies expiry by key prefix and keeps picks forever', async () => {
  const redis = fakeRedis();
  const store = createRedisStore(redis);
  await store.setJSON('cache/abc', {a: 1});
  await store.setJSON('picks/abc', {items: []});
  assert.ok(redis.ttls.get('cache/abc') > 0);
  assert.equal(redis.ttls.has('picks/abc'), false);
});
