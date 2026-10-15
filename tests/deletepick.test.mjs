import test from 'node:test';
import assert from 'node:assert/strict';
import {createService, hash} from '../server/service.mjs';
import {makeHandler} from '../server/handler.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {
  createFakeSupabase,
  PUBLISHABLE_KEY,
  SERVICE_KEY,
  SUPABASE_URL,
} from './helpers/fake-supabase.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const HOUR = 3_600_000;
const ORIGIN = 'https://app.example';
const USER = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'a@b.co',
  user_metadata: {user_name: 'octo'},
};

function setup() {
  let clock = base;
  const db = createFakeSupabase();
  const store = createMemoryStore();
  const service = createService({
    env: {
      SUPABASE_URL,
      SUPABASE_SECRET_KEY: SERVICE_KEY,
      SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    },
    store,
    fetcher: db.fetcher,
    now: () => clock,
  });
  return {service, db, store, advance: (ms) => (clock += ms)};
}

/** A pick object as the key-value store keeps it. */
const pick = (name, {hoursToKickoff = 5, result = null} = {}) => ({
  id: hash(name),
  canonical: name,
  outcome: 0,
  createdAt: base - HOUR,
  forecast: {
    home: 'A',
    away: 'B',
    competition: 'CL',
    kickoff: new Date(base + hoursToKickoff * HOUR).toISOString(),
    p: [50, 25, 25],
  },
  result,
  score: result ? '1–0' : null,
});

test('anonymous profile: a pending pick can be removed before kickoff', async () => {
  const x = setup();
  const sid = hash('browser');
  await x.store.setJSON('picks/' + sid, {items: [pick('m1'), pick('m2')]});

  assert.deepEqual(await x.service.deletePick(sid, hash('m1')), {removed: true});
  assert.deepEqual(
    (await x.service.picks(sid)).map((p) => p.canonical),
    ['m2'],
  );
});

test('removal is refused after kickoff and for settled picks', async () => {
  const x = setup();
  const sid = hash('browser');
  await x.store.setJSON('picks/' + sid, {
    items: [
      pick('early', {hoursToKickoff: 5}),
      pick('started', {hoursToKickoff: -1}),
      pick('won', {hoursToKickoff: -30, result: 'correct'}),
      pick('lost', {hoursToKickoff: -30, result: 'incorrect'}),
      pick('cancelled', {hoursToKickoff: 5, result: 'void'}),
    ],
  });

  await assert.rejects(() => x.service.deletePick(sid, hash('started')), /Kickoff has passed/);
  await assert.rejects(
    () => x.service.deletePick(sid, hash('won')),
    /Settled picks cannot be removed/,
  );
  await assert.rejects(
    () => x.service.deletePick(sid, hash('lost')),
    /Settled picks cannot be removed/,
  );
  await assert.rejects(
    () => x.service.deletePick(sid, hash('cancelled')),
    /Settled picks cannot be removed/,
  );
  assert.equal((await x.service.picks(sid)).length, 5, 'nothing was removed');

  // The deadline is the kickoff time itself.
  x.advance(5 * HOUR);
  await assert.rejects(() => x.service.deletePick(sid, hash('early')), /Kickoff has passed/);
});

test('unknown or malformed ids are refused', async () => {
  const x = setup();
  const sid = hash('browser');
  await x.store.setJSON('picks/' + sid, {items: [pick('m1')]});
  await assert.rejects(() => x.service.deletePick(sid, hash('other')), /no longer exists/);
  for (const bad of ['', 'abc', undefined, null, 'x'.repeat(64)])
    await assert.rejects(() => x.service.deletePick(sid, bad), /Invalid pick/, String(bad));
  assert.equal((await x.service.picks(sid)).length, 1);
});

test('one person cannot remove another person’s pick', async () => {
  const x = setup();
  await x.store.setJSON('picks/' + hash('alice'), {items: [pick('m1')]});
  await x.store.setJSON('picks/' + hash('bob'), {items: [pick('m2')]});
  await assert.rejects(() => x.service.deletePick(hash('bob'), hash('m1')), /no longer exists/);
  assert.equal((await x.service.picks(hash('alice'))).length, 1);
});

test('account picks (Supabase): same rules, scoped to the signed-in person', async () => {
  const x = setup();
  const row = (name, {hoursToKickoff = 5, result = null, user = USER.id} = {}) => ({
    user_id: user,
    pick_id: hash(name),
    canonical: name,
    outcome: 0,
    created_at: new Date(base - HOUR).toISOString(),
    forecast: pick(name, {hoursToKickoff}).forecast,
    result,
    score: null,
  });
  x.db.tables.picks.push(
    row('open'),
    row('started', {hoursToKickoff: -1}),
    row('settled', {hoursToKickoff: -30, result: 'correct'}),
    row('theirs', {user: 'someone-else'}),
  );
  const sid = 'acct:' + USER.id;

  assert.deepEqual(await x.service.deletePick(sid, hash('open')), {removed: true});
  await assert.rejects(() => x.service.deletePick(sid, hash('started')), /Kickoff has passed/);
  await assert.rejects(
    () => x.service.deletePick(sid, hash('settled')),
    /Settled picks cannot be removed/,
  );
  await assert.rejects(() => x.service.deletePick(sid, hash('theirs')), /no longer exists/);
  assert.deepEqual(x.db.tables.picks.map((r) => r.canonical).sort(), [
    'settled',
    'started',
    'theirs',
  ]);
});

test('the database itself refuses to delete a settled row (race safety)', async () => {
  const x = setup();
  const sid = 'acct:' + USER.id;
  x.db.tables.picks.push({
    user_id: USER.id,
    pick_id: hash('m'),
    canonical: 'm',
    outcome: 0,
    created_at: new Date(base).toISOString(),
    forecast: pick('m').forecast,
    result: 'incorrect',
    score: '0–1',
  });
  // Bypass the server-side checks: the store's own delete must still leave settled rows alone.
  const {createPickStore} = await import('../server/service/pickstore.mjs');
  const {createStorage} = await import('../server/service/storage.mjs');
  const {createSupabase} = await import('../server/supabase.mjs');
  const store = createPickStore({
    storage: createStorage({store: createMemoryStore(), now: () => base}),
    supabase: createSupabase({
      url: SUPABASE_URL,
      key: SERVICE_KEY,
      authKey: PUBLISHABLE_KEY,
      fetcher: x.db.fetcher,
    }),
  });
  assert.equal(await store.remove(sid, hash('m')), false);
  assert.equal(x.db.tables.picks.length, 1);
});

test('after removal the match can be picked again', async () => {
  const x = setup();
  const sid = hash('browser');
  const {createPickStore} = await import('../server/service/pickstore.mjs');
  const {createStorage} = await import('../server/service/storage.mjs');
  const store = createPickStore({
    storage: createStorage({store: x.store, now: () => base}),
    supabase: null,
  });

  assert.equal(await store.add(sid, pick('m1')), true);
  assert.equal(await store.add(sid, pick('m1')), false, 'duplicates are still refused');
  await x.service.deletePick(sid, hash('m1'));
  assert.equal(await store.add(sid, pick('m1')), true, 'the match is free again');
});

test('HTTP: delete-pick needs the app origin and a valid id', async () => {
  const x = setup();
  const handler = makeHandler(() => x.service, {});
  const jar = {jk_session: 'a'.repeat(64)};
  await x.store.setJSON('picks/' + hash(jar.jk_session), {
    items: [pick('m1'), pick('m2', {hoursToKickoff: -2})],
  });
  const post = (body, origin = ORIGIN) =>
    handler(
      new Request(`${ORIGIN}/api/football`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          cookie: `jk_session=${jar.jk_session}`,
        },
        body: JSON.stringify(body),
      }),
    );

  assert.equal(
    (await post({action: 'delete-pick', pickId: hash('m1')}, 'https://evil.test')).status,
    403,
  );
  assert.equal((await post({action: 'delete-pick', pickId: 'nope'})).status, 400);
  const locked = await post({action: 'delete-pick', pickId: hash('m2')});
  assert.equal(locked.status, 409);
  assert.equal((await locked.json()).code, 'locked');

  const ok = await post({action: 'delete-pick', pickId: hash('m1')});
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {removed: true});
  const again = await post({action: 'delete-pick', pickId: hash('m1')});
  assert.equal(again.status, 404, 'removing twice is a clear error');
});
