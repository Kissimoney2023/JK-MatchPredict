import test from 'node:test';
import assert from 'node:assert/strict';
import {createService, hash} from '../server/service.mjs';
import {makeHandler, makePrefetchHandler} from '../server/handler.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const MIN = 60_000;
const ORIGIN = 'https://app.example';
const VAPID = {VAPID_PUBLIC_KEY: 'BPublicKeyForTests', VAPID_PRIVATE_KEY: 'privateKeyForTests'};

let counter = 0;
const subscription = (host = 'fcm.googleapis.com') => ({
  endpoint: `https://${host}/fcm/send/device-${++counter}`,
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u',
    auth: 'tBHItJI5svbpez7KI4CCXg',
  },
});

function setup(env = VAPID) {
  let clock = base;
  const sent = [];
  const failWith = {};
  const store = createMemoryStore();
  const service = createService({
    env,
    store,
    now: () => clock,
    sendPush: async (sub, payload) => {
      if (failWith.error) throw failWith.error;
      sent.push({sub, payload});
    },
  });
  return {service, store, sent, failWith, advance: (ms) => (clock += ms)};
}

const pick = (name, {minutes = 30, result = null, outcome = 0} = {}) => ({
  id: hash(name),
  canonical: name,
  outcome,
  createdAt: base - 60 * MIN,
  forecast: {
    home: 'Arsenal',
    away: 'Chelsea',
    competition: 'CL',
    kickoff: new Date(base + minutes * MIN).toISOString(),
    p: [50, 25, 25],
  },
  result,
});

const SID = hash('browser');
async function withPicks(x, picks, sid = SID) {
  await x.store.setJSON('picks/' + sid, {items: picks});
}

test('reminders are off, and say so, until the VAPID keys are configured', async () => {
  const x = setup({});
  assert.deepEqual(x.service.status().push, {enabled: false});
  await assert.rejects(() => x.service.reminders.subscribe(SID, subscription()), /not configured/);
  assert.deepEqual((await x.service.reminders.run()).sent, 0);
  assert.equal(x.service.status().push.publicKey, undefined);
});

test('status exposes only the public key', () => {
  const x = setup();
  assert.deepEqual(x.service.status().push, {enabled: true, publicKey: VAPID.VAPID_PUBLIC_KEY});
  assert.ok(!JSON.stringify(x.service.status()).includes(VAPID.VAPID_PRIVATE_KEY));
});

test('only the browser vendors push services are accepted', async () => {
  const x = setup();
  for (const host of [
    'fcm.googleapis.com',
    'updates.push.services.mozilla.com',
    'web.push.apple.com',
    'wns2-par02p.notify.windows.com',
  ])
    assert.deepEqual(await x.service.reminders.subscribe(SID + host, subscription(host)), {
      subscribed: true,
    });
  for (const endpoint of [
    'https://evil.example/push',
    'https://fcm.googleapis.com.evil.example/x',
    'https://169.254.169.254/latest/meta-data',
    'http://fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://user:pw@fcm.googleapis.com/x',
    'not a url',
  ])
    await assert.rejects(
      () => x.service.reminders.subscribe(SID, {...subscription(), endpoint}),
      /not valid/,
      endpoint,
    );
  await assert.rejects(
    () => x.service.reminders.subscribe(SID, {...subscription(), keys: {p256dh: 'x', auth: 'y'}}),
    /not valid/,
  );
});

test('a pick starting within 45 minutes triggers one reminder, only once', async () => {
  const x = setup();
  await withPicks(x, [pick('soon', {minutes: 30})]);
  await x.service.reminders.subscribe(SID, subscription());

  const first = await x.service.reminders.run();
  assert.equal(first.sent, 1);
  assert.equal(x.sent[0].payload.title, 'Kickoff soon');
  assert.match(x.sent[0].payload.body, /Arsenal vs Chelsea starts in about 30 minutes/);
  assert.match(x.sent[0].payload.body, /home win/);
  assert.equal(x.sent[0].sub.endpoint.startsWith('https://fcm.googleapis.com/'), true);

  x.advance(10 * MIN);
  assert.equal((await x.service.reminders.run()).sent, 0, 'not repeated');
  assert.equal(x.sent.length, 1);
});

test('nothing is sent for far-off, started, settled or removed picks', async () => {
  const x = setup();
  await withPicks(x, [
    pick('tomorrow', {minutes: 24 * 60}),
    pick('started', {minutes: -5}),
    pick('settled', {minutes: 20, result: 'correct'}),
  ]);
  await x.service.reminders.subscribe(SID, subscription());
  assert.equal((await x.service.reminders.run()).sent, 0);

  // A pick that is removed before the reminder is never announced.
  await withPicks(x, [pick('gone', {minutes: 20})]);
  await x.service.deletePick(SID, hash('gone'));
  assert.equal((await x.service.reminders.run()).sent, 0);
  assert.equal(x.sent.length, 0);
});

test('several matches become one message; the next pick still gets its own later', async () => {
  const x = setup();
  await withPicks(x, [
    pick('a', {minutes: 20}),
    pick('b', {minutes: 40}),
    pick('c', {minutes: 120}),
  ]);
  await x.service.reminders.subscribe(SID, subscription());
  assert.equal((await x.service.reminders.run()).sent, 1);
  assert.match(x.sent[0].payload.body, /^2 of your picked matches start within about 40 minutes/);

  x.advance(80 * MIN); // c is now 40 minutes away
  assert.equal((await x.service.reminders.run()).sent, 1);
  assert.match(x.sent[1].payload.body, /Arsenal vs Chelsea starts in about 40 minutes/);
});

test('each subscriber only hears about their own profile', async () => {
  const x = setup();
  const other = hash('someone else');
  await withPicks(x, [pick('mine', {minutes: 20})]);
  await withPicks(x, [], other);
  const mine = subscription();
  const theirs = subscription();
  await x.service.reminders.subscribe(SID, mine);
  await x.service.reminders.subscribe(other, theirs);
  await x.service.reminders.run();
  assert.deepEqual(
    x.sent.map((s) => s.sub.endpoint),
    [mine.endpoint],
  );
});

test('a browser that unsubscribed or expired (410) is forgotten', async () => {
  const x = setup();
  await withPicks(x, [pick('soon', {minutes: 20})]);
  const sub = subscription();
  await x.service.reminders.subscribe(SID, sub);
  x.failWith.error = Object.assign(new Error('gone'), {statusCode: 410});
  const result = await x.service.reminders.run();
  assert.equal(result.removed, 1);
  assert.equal(result.sent, 0);
  assert.equal((await x.store.get('push/index', {type: 'json'})).subs.length, 0);
  x.failWith.error = null;
  assert.equal((await x.service.reminders.run()).sent, 0, 'no longer a subscriber');
});

test('a failing push service is counted, not fatal, and is retried next run', async () => {
  const x = setup();
  await withPicks(x, [pick('soon', {minutes: 30})]);
  await x.service.reminders.subscribe(SID, subscription());
  x.failWith.error = Object.assign(new Error('boom'), {statusCode: 500});
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await x.service.reminders.run()).errors, 1);
  } finally {
    console.error = originalError;
  }
  x.failWith.error = null;
  x.advance(5 * MIN);
  assert.equal((await x.service.reminders.run()).sent, 1, 'not marked as sent after a failure');
});

test('unsubscribing stops reminders; limits protect the store', async () => {
  const x = setup();
  await withPicks(x, [pick('soon', {minutes: 30})]);
  const sub = subscription();
  await x.service.reminders.subscribe(SID, sub);
  await x.service.reminders.unsubscribe(sub.endpoint);
  assert.equal((await x.service.reminders.run()).sent, 0);

  for (let i = 0; i < 5; i++) await x.service.reminders.subscribe(SID, subscription());
  await assert.rejects(
    () => x.service.reminders.subscribe(SID, subscription()),
    /Too many devices/,
  );
});

test('subscribing again after sign-in moves reminders to the account', async () => {
  const x = setup();
  const sub = subscription();
  await x.service.reminders.subscribe(SID, sub);
  await x.service.reminders.subscribe('acct:user-1', sub);
  const index = await x.store.get('push/index', {type: 'json'});
  assert.deepEqual(
    index.subs.map((s) => s.sid),
    ['acct:user-1'],
  );
  const record = await x.store.get('push/sub/' + hash(sub.endpoint), {type: 'json'});
  assert.equal(record.sid, 'acct:user-1');
});

// ---------- through the HTTP handlers ----------

test('the app handler subscribes and unsubscribes; the cron handler runs reminders', async () => {
  const x = setup({...VAPID, CRON_SECRET: 'cron-secret'});
  const handler = makeHandler(() => x.service, {});
  const call = (body) =>
    handler(
      new Request(ORIGIN + '/api/football', {
        method: 'POST',
        headers: {'content-type': 'application/json', origin: ORIGIN},
        body: JSON.stringify(body),
      }),
    );
  const sub = subscription();
  const subscribed = await call({action: 'push-subscribe', subscription: sub});
  assert.equal(subscribed.status, 200);
  assert.deepEqual(await subscribed.json(), {subscribed: true});

  const bad = await call({
    action: 'push-subscribe',
    subscription: {endpoint: 'https://evil.example/'},
  });
  assert.equal(bad.status, 400);

  const cron = makePrefetchHandler(() => ({...x.service, prefetch: async () => ({warmed: true})}), {
    CRON_SECRET: 'cron-secret',
  });
  const denied = await cron(new Request(ORIGIN + '/api/prefetch'));
  assert.equal(denied.status, 401);
  const ok = await cron(
    new Request(ORIGIN + '/api/prefetch', {headers: {authorization: 'Bearer cron-secret'}}),
  );
  const body = await ok.json();
  assert.equal(body.warmed, true);
  assert.equal(body.reminders.subscribers, 1);

  const gone = await call({action: 'push-unsubscribe', endpoint: sub.endpoint});
  assert.deepEqual(await gone.json(), {subscribed: false});
});
