import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../server/service.mjs';
import {makeHandler, makeShareHandler} from '../server/handler.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {buildSnapshot, isShareId} from '../server/service/shares.mjs';
import {renderSharePage} from '../server/sharepage.mjs';
import {
  createFakeSupabase,
  PUBLISHABLE_KEY,
  SERVICE_KEY,
  SUPABASE_URL,
} from './helpers/fake-supabase.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const ORIGIN = 'https://app.example';
const USER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'private.person@example.com',
  user_metadata: {user_name: 'octofan'},
};

function setup(env = {}) {
  let clock = base;
  const db = createFakeSupabase();
  const service = createService({
    env: {
      SUPABASE_URL,
      SUPABASE_SECRET_KEY: SERVICE_KEY,
      SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
      ...env,
    },
    store: createMemoryStore(),
    fetcher: db.fetcher,
    now: () => clock,
  });
  return {service, db, advance: (ms) => (clock += ms)};
}

async function signIn(x) {
  const {url, verifier} = await x.service.accounts.startLogin({origin: ORIGIN, ip: '1.1.1.1'});
  const code = x.db.issueCode(USER, url);
  return x.service.accounts.completeLogin({code, verifier, anonymousSid: null});
}

let n = 0;
/** A picks row as stored in Supabase. */
const row = (result, overrides = {}) => {
  n++;
  return {
    user_id: USER.id,
    pick_id: 'p' + n,
    canonical: 'c' + n,
    outcome: 0,
    created_at: new Date(base - n * 1000).toISOString(),
    forecast: {
      home: 'Arsenal',
      away: 'Inter',
      competition: 'UEFA Champions League',
      kickoff: new Date(Date.UTC(2026, 8, n)).toISOString(),
      p: [55, 25, 20],
      source: 'demo',
    },
    result,
    score: result ? '2–1' : null,
    ...overrides,
  };
};

const pickOf = (r) => ({
  id: r.pick_id,
  canonical: r.canonical,
  outcome: r.outcome,
  createdAt: Date.parse(r.created_at),
  forecast: r.forecast,
  result: r.result,
  score: r.score,
});

test('a snapshot holds statistics and the last settled picks only', () => {
  n = 0;
  const rows = [
    ...Array.from({length: 12}, (_, i) => row(i % 3 === 0 ? 'incorrect' : 'correct')),
    row(null), // pending: must never appear
    row('void'),
  ];
  const snap = buildSnapshot(rows.map(pickOf), 123);
  assert.equal(snap.generatedAt, 123);
  assert.equal(snap.settled, 12);
  assert.equal(snap.picks.length, 10, 'only the last ten settled picks');
  assert.ok(snap.picks.every((p) => p.result === 'correct' || p.result === 'incorrect'));
  assert.ok(snap.picks[0].date > snap.picks[9].date, 'newest first');
  assert.equal(snap.picks[0].pick, 'Arsenal win');
  assert.equal(snap.recent.length, 10);
  const text = JSON.stringify(snap);
  assert.ok(!text.includes('@'), 'no email addresses');
  assert.ok(!text.includes('canonical') && !text.includes('user_id'));
  assert.equal(buildSnapshot([], 1).settled, 0);
});

test('share ids are validated before touching the database', () => {
  assert.equal(isShareId('abcdefABCDEF'), true);
  assert.equal(isShareId('abc_-123_-12'), true);
  for (const bad of [
    '',
    'short',
    'toolongtoolong1',
    'has space!!!',
    "a'b=eq.x&sel",
    null,
    undefined,
  ])
    assert.equal(isShareId(bad), false, String(bad));
});

test('publishing creates one stable link per person and respects the name choice', async () => {
  n = 0;
  const x = setup();
  const {account} = await signIn(x);
  x.db.tables.picks.push(row('correct'), row('incorrect'), row('correct'));

  const first = await x.service.shares.publish({
    userId: account.id,
    showName: false,
    displayName: 'octofan',
    origin: ORIGIN,
  });
  assert.equal(first.enabled, true);
  assert.match(first.url, /^https:[/][/]app[.]example[/]s[/][A-Za-z0-9_-]{12}$/);
  const stored = x.db.tables.shares[0];
  assert.equal(stored.display_name, null, 'the name is not stored unless the person opts in');
  assert.equal(stored.show_name, false);

  x.db.tables.picks.push(row('correct'));
  x.advance(60_000);
  const again = await x.service.shares.publish({
    userId: account.id,
    showName: true,
    displayName: 'octofan',
    origin: ORIGIN,
  });
  assert.equal(again.url, first.url, 'refreshing keeps the same address');
  assert.equal(x.db.tables.shares.length, 1);
  assert.equal(x.db.tables.shares[0].display_name, 'octofan');
  assert.equal(x.db.tables.shares[0].snapshot.settled, 4, 'the snapshot was refreshed');
});

test('nothing to share yet, rate limit, and switching a link off', async () => {
  n = 0;
  const x = setup();
  const {account} = await signIn(x);
  const publish = () =>
    x.service.shares.publish({
      userId: account.id,
      showName: false,
      displayName: null,
      origin: ORIGIN,
    });

  await assert.rejects(publish, /at least one settled pick/);
  x.db.tables.picks.push(row('correct'));
  const {url} = await publish();
  const id = url.split('/s/')[1];
  assert.ok(await x.service.shares.get(id));

  assert.deepEqual(await x.service.shares.disable(account.id), {exists: true, enabled: false});
  assert.equal(await x.service.shares.get(id), null, 'a disabled link stops working at once');
  assert.equal((await x.service.shares.status(account.id, ORIGIN)).url, null);

  for (let i = 0; i < 8; i++) await publish(); // 10 per hour in total (3 so far)
  await assert.rejects(publish, /budget/);
});

test('the public page escapes everything and reveals neither email nor hidden name', async () => {
  n = 0;
  const html = renderSharePage({
    displayName: null,
    snapshot: buildSnapshot(
      [
        pickOf(
          row('correct', {
            forecast: {
              home: '<img src=x onerror=alert(1)>',
              away: 'B"&C',
              competition: '<b>League</b>',
              kickoff: '2026-09-01T00:00:00Z',
              p: [50, 30, 20],
            },
          }),
        ),
      ],
      1,
    ),
    updatedAt: base,
    origin: ORIGIN,
    id: 'abcdefABCDEF',
  });
  assert.ok(!html.includes('<img src=x'), 'markup in team names must be escaped');
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(html.includes('A MatchPredict player'));
  assert.ok(html.includes('noindex'));
  assert.ok(html.includes('https://app.example/s/abcdefABCDEF'));
  assert.ok(!html.includes('<script'), 'the page needs no scripts (strict CSP)');
});

// ---------- HTTP ----------

test('HTTP: sign in, publish, view publicly, then switch off', async () => {
  n = 0;
  const x = setup();
  const handler = makeHandler(() => x.service, {});
  const shareHandler = makeShareHandler(() => x.service, {});
  const {authToken} = await signIn(x);
  x.db.tables.picks.push(row('correct'), row('incorrect'), row('correct'));
  const jar = `jk_session=${'a'.repeat(64)}; jk_auth=${authToken}`;

  const get = (action, cookie = jar) =>
    handler(new Request(`${ORIGIN}/api/football?action=${action}`, {headers: {cookie}}));
  const post = (body, cookie = jar) =>
    handler(
      new Request(`${ORIGIN}/api/football`, {
        method: 'POST',
        headers: {origin: ORIGIN, 'content-type': 'application/json', cookie},
        body: JSON.stringify(body),
      }),
    );

  // Signed out: refused.
  assert.equal((await get('share', '')).status, 401);
  assert.equal((await post({action: 'share-create'}, '')).status, 401);

  assert.equal((await (await get('share')).json()).exists, false);
  const created = await post({action: 'share-create', showName: false});
  assert.equal(created.status, 200);
  const {url} = await created.json();
  const id = url.split('/s/')[1];

  // Anyone can open it, without cookies.
  const open = (link) => shareHandler(new Request(`${ORIGIN}/api/share?id=${link}`));
  const page = await open(id);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text[/]html/);
  assert.match(page.headers.get('cache-control'), /s-maxage=60/);
  const html = await page.text();
  assert.ok(html.includes('A MatchPredict player'));
  assert.ok(!html.includes('octofan'), 'the GitHub name stays hidden unless opted in');
  assert.ok(!html.includes('private.person@example.com'), 'the email is never exposed');
  assert.ok(html.includes('67%'), 'two of three correct');

  // Opting in shows the name.
  await post({action: 'share-create', showName: true});
  assert.ok((await (await open(id)).text()).includes('octofan'));

  // Unknown or malformed links look identical.
  assert.equal((await open('zzzzzzzzzzzz')).status, 404);
  assert.equal((await open('bad id')).status, 404);
  assert.equal((await open('')).status, 404);

  // Switching off makes the link a 404.
  assert.equal((await post({action: 'share-disable'})).status, 200);
  const gone = await open(id);
  assert.equal(gone.status, 404);
  assert.ok(!(await gone.text()).includes('octofan'));
  assert.equal((await (await get('share')).json()).enabled, false);
});

test('HTTP: a database failure on the public page is a plain 503, not a leak', async () => {
  const x = setup();
  const shareHandler = makeShareHandler(() => x.service, {});
  x.db.setFailing(true);
  const r = await shareHandler(new Request(`${ORIGIN}/api/share?id=abcdefABCDEF`));
  assert.equal(r.status, 503);
  assert.ok(!(await r.text()).includes('supabase'));
});
