import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../server/service.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {makeHandler, makePrefetchHandler} from '../server/handler.mjs';
import {
  createFakeSupabase,
  PUBLISHABLE_KEY,
  SERVICE_KEY,
  SUPABASE_URL,
} from './helpers/fake-supabase.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const HOUR = 3_600_000;

function setup(env = {}, {withSupabase = true} = {}) {
  let clock = base;
  const db = createFakeSupabase();
  const service = createService({
    env: {
      API_FOOTBALL_KEY: 'ap-secret-value',
      ...(withSupabase
        ? {
            SUPABASE_URL,
            SUPABASE_SECRET_KEY: SERVICE_KEY,
            SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
          }
        : {}),
      ...env,
    },
    store: createMemoryStore(),
    fetcher: db.fetcher,
    now: () => clock,
  });
  return {service, db, advance: (ms) => (clock += ms)};
}

const find = (result, id) => result.items.find((i) => i.id === id);

test('a healthy site: keys accepted, providers on, tables readable', async () => {
  const x = setup();
  const result = await x.service.diagnostics.run();
  assert.equal(find(result, 'football').state, 'ok');
  assert.equal(find(result, 'supabase-key').state, 'ok');
  assert.equal(find(result, 'provider-github').state, 'ok');
  assert.equal(find(result, 'supabase-tables').state, 'ok');
  assert.equal(find(result, 'storage').state, 'warn', 'in-memory storage is not durable');
  assert.equal(find(result, 'striker').state, 'info');
  assert.equal(result.summary.problems, 0);
});

test('a wrong publishable key is named as the problem, with the fix', async () => {
  const x = setup({SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_not_the_right_one'});
  const result = await x.service.diagnostics.run();
  const key = find(result, 'supabase-key');
  assert.equal(key.state, 'error');
  assert.match(key.detail, /refused the publishable key/);
  assert.match(key.fix, /Project Settings → API Keys/);
  assert.equal(
    find(result, 'provider-github'),
    undefined,
    'nothing else is claimed without a working key',
  );
  assert.ok(result.summary.problems >= 1);
});

test('a missing publishable key is flagged even when the secret key happens to work', async () => {
  const x = setup({SUPABASE_PUBLISHABLE_KEY: ''});
  const key = find(await x.service.diagnostics.run(), 'supabase-key');
  assert.equal(key.state, 'warn');
  assert.match(key.detail, /SUPABASE_PUBLISHABLE_KEY is not set/);
});

test('a sign-in provider that is off in Supabase is an error; Google is checked only when enabled', async () => {
  const off = setup();
  off.db.providers.github = false;
  const github = find(await off.service.diagnostics.run(), 'provider-github');
  assert.equal(github.state, 'error');
  assert.match(github.fix, /Authentication/);

  const both = setup({AUTH_PROVIDERS: 'github,google'});
  const result = await both.service.diagnostics.run();
  assert.equal(find(result, 'provider-github').state, 'ok');
  assert.equal(
    find(result, 'provider-google').state,
    'error',
    'google is requested but not enabled',
  );

  const defaults = setup();
  assert.equal(find(await defaults.service.diagnostics.run(), 'provider-google'), undefined);
});

test('missing tables are listed, with the schema file as the fix', async () => {
  const x = setup();
  x.db.dropTable('shares');
  const tables = find(await x.service.diagnostics.run(), 'supabase-tables');
  assert.equal(tables.state, 'error');
  assert.match(tables.detail, /shares/);
  assert.ok(!/profiles/.test(tables.detail), 'only the unreadable tables are named');
  assert.match(tables.fix, /supabase\/schema\.sql/);
});

test('Supabase being down is reported as that, not as a bad key', async () => {
  const x = setup();
  x.db.setFailing(true);
  const result = await x.service.diagnostics.run();
  const supabase = find(result, 'supabase-key');
  assert.equal(supabase.state, 'warn');
  assert.match(supabase.detail, /did not answer/);
  assert.match(supabase.fix, /Restore project/);
  assert.equal(find(result, 'supabase-tables'), undefined);
});

test('accounts that are not configured are simply optional', async () => {
  const x = setup({}, {withSupabase: false});
  const result = await x.service.diagnostics.run();
  assert.equal(find(result, 'accounts').state, 'info');
  assert.equal(find(result, 'supabase-key'), undefined);
});

test('no football key at all is a problem', async () => {
  const x = setup({API_FOOTBALL_KEY: ''});
  const football = find(await x.service.diagnostics.run(), 'football');
  assert.equal(football.state, 'missing');
  assert.match(football.fix, /API_FOOTBALL_KEY or FOOTBALL_DATA_ORG_KEY/);
});

test('the scheduled job: no secret, never run, recently run, gone quiet', async () => {
  const noSecret = setup();
  assert.match(
    find(await noSecret.service.diagnostics.run(), 'cron').detail,
    /CRON_SECRET is not set/,
  );

  const x = setup({CRON_SECRET: 'cron-secret-value'});
  let cron = find(await x.service.diagnostics.run(), 'cron');
  assert.equal(cron.state, 'warn');
  assert.match(cron.detail, /has not run yet/);

  await x.service.diagnostics.recordRun({errors: []});
  x.advance(3 * HOUR);
  cron = find(await x.service.diagnostics.run(), 'cron');
  assert.equal(cron.state, 'ok');
  assert.match(cron.detail, /Last ran 3 hours ago/);

  x.advance(40 * HOUR);
  cron = find(await x.service.diagnostics.run(), 'cron');
  assert.equal(cron.state, 'warn');
  assert.match(cron.detail, /last ran/);
});

test('reminder keys: both, one, or none', async () => {
  assert.equal(find(await setup().service.diagnostics.run(), 'reminders').state, 'info');
  assert.equal(
    find(await setup({VAPID_PUBLIC_KEY: 'pub'}).service.diagnostics.run(), 'reminders').state,
    'error',
  );
  assert.equal(
    find(
      await setup({VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv'}).service.diagnostics.run(),
      'reminders',
    ).state,
    'ok',
  );
});

test('results are reused for two minutes, so refreshing the page does not hammer Supabase', async () => {
  const x = setup();
  await x.service.diagnostics.run();
  const requests = x.db.requests.length;
  await x.service.diagnostics.run();
  assert.equal(x.db.requests.length, requests);
  x.advance(3 * 60_000);
  await x.service.diagnostics.run();
  assert.ok(x.db.requests.length > requests);
});

test('the report never contains a key or secret value', async () => {
  const secrets = {
    API_FOOTBALL_KEY: 'ap-secret-value',
    FOOTBALL_DATA_ORG_KEY: 'fd-secret-value',
    STRIKERAPI_API_KEY: 'striker-secret-value',
    CRON_SECRET: 'cron-secret-value',
    VAPID_PUBLIC_KEY: 'vapid-public-value',
    VAPID_PRIVATE_KEY: 'vapid-private-value',
  };
  const x = setup(secrets);
  const text = JSON.stringify(await x.service.diagnostics.run());
  for (const value of [...Object.values(secrets), SERVICE_KEY, PUBLISHABLE_KEY, SUPABASE_URL])
    assert.ok(!text.includes(value), 'must not contain ' + value.slice(0, 12));
});

test("HTTP: the report opens only with the site owner's CRON_SECRET", async () => {
  const x = setup({CRON_SECRET: 'cron-secret-value'});
  const handler = makeHandler(() => x.service, {CRON_SECRET: 'cron-secret-value'});
  const ask = (authorization) =>
    handler(
      new Request('https://app.example/api/football?action=diagnostics', {
        headers: authorization ? {authorization} : {},
      }),
    );

  const none = await ask();
  assert.equal(none.status, 401);
  assert.deepEqual(await none.json(), {locked: true, reason: 'key'});
  const wrong = await ask('Bearer not-the-secret');
  assert.equal(wrong.status, 401);
  assert.ok(
    !JSON.stringify(await wrong.json()).includes('football'),
    'nothing about the setup leaks',
  );

  const ok = await ask('Bearer cron-secret-value');
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.ok(Array.isArray(body.items) && body.items.length > 5);
  assert.equal(typeof body.summary.problems, 'number');
});

test('HTTP: without a CRON_SECRET the report stays locked and says why', async () => {
  const x = setup();
  const handler = makeHandler(() => x.service, {});
  const response = await handler(
    new Request('https://app.example/api/football?action=diagnostics', {
      headers: {authorization: 'Bearer anything'},
    }),
  );
  assert.deepEqual(await response.json(), {locked: true, reason: 'not_configured'});
});

test('the scheduled job records that it ran, so the check can say when', async () => {
  const x = setup({CRON_SECRET: 'cron-secret-value'});
  const cron = makePrefetchHandler(
    () => ({
      ...x.service,
      reminders: {run: async () => ({sent: 0})},
      prefetch: async () => ({errors: []}),
      potd: {refresh: async () => ({skipped: true})},
    }),
    {CRON_SECRET: 'cron-secret-value'},
  );
  const ran = await cron(
    new Request('https://app.example/api/prefetch', {
      headers: {authorization: 'Bearer cron-secret-value'},
    }),
  );
  assert.equal(ran.status, 200);
  x.advance(3 * 60_000); // past the two-minute reuse window
  const again = find(await x.service.diagnostics.run(), 'cron');
  assert.equal(again.state, 'ok');
  assert.match(again.detail, /Last ran/);
});

test('the page lists each check with its state and fix, escaped', async () => {
  const {diagnosticsList} = await import('../public/js/views/diagnostics.js');
  const html = diagnosticsList({
    checkedAt: base,
    summary: {problems: 1, warnings: 1},
    items: [
      {id: 'a', label: 'Football data', state: 'ok', detail: 'Connected.'},
      {
        id: 'b',
        label: '<img src=x onerror=alert(1)>',
        state: 'error',
        detail: 'Bad "key" & more',
        fix: 'Do <this>',
      },
      {id: 'c', label: 'Storage', state: 'warn', detail: 'Temporary.'},
      {id: 'd', label: 'Odd', state: 'surprise', detail: 'x'},
    ],
  });
  assert.match(html, /1 thing to fix and 1 to check/);
  assert.match(html, /diag diag-ok"><span class="diag-state">OK/);
  assert.match(html, /diag diag-error"><span class="diag-state">Fix/);
  assert.match(html, /How to fix: Do &lt;this&gt;/);
  assert.ok(!html.includes('<img src=x'), 'labels are escaped');
  assert.match(
    html,
    /diag diag-info"><span class="diag-state">Info/,
    'unknown states render as info',
  );
  assert.match(
    diagnosticsList({checkedAt: base, summary: {problems: 0, warnings: 0}, items: []}),
    /Everything checked is in order/,
  );
});
