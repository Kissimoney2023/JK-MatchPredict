import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../server/service.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {createStorage} from '../server/service/storage.mjs';
import {createProviderClient} from '../server/service/provider.mjs';

const params = () => new URLSearchParams({from: '2026-10-14', to: '2026-10-14'});

test('an upstream outage explains the cause, and the cooldown repeats it', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({message: 'Upstream exploded'}, {status: 500});
  };
  const service = createService({
    env: {API_FOOTBALL_KEY: 'secret-key'},
    store: createMemoryStore(),
    fetcher,
  });

  const first = await service.fixtures(params()).catch((e) => e);
  assert.match(first.message, /HTTP 500/);
  assert.match(first.message, /Upstream exploded/);
  assert.doesNotMatch(first.message, /secret-key/);

  const second = await service.fixtures(params()).catch((e) => e);
  assert.match(second.message, /Upstream exploded/);
  assert.match(second.message, /paused/);
  assert.equal(calls, 1, 'the cooldown must stop further provider calls');
});

test('plan or season rejections on a 200 response are shown to the user', async () => {
  const fetcher = async () =>
    Response.json({
      response: [],
      errors: {plan: 'Free plans do not have access to this season'},
      paging: {total: 1},
    });
  const service = createService({
    env: {API_FOOTBALL_KEY: 'k'},
    store: createMemoryStore(),
    fetcher,
  });
  const error = await service.fixtures(params()).catch((e) => e);
  assert.match(error.message, /Free plans do not have access to this season/);
});

test('a free-plan season limit falls back cleanly and is not retried', async () => {
  let apCalls = 0;
  const fdMatch = {
    id: 200,
    competition: {code: 'CL', name: 'UEFA Champions League'},
    utcDate: '2026-10-14T20:00:00Z',
    status: 'TIMED',
    season: {startDate: '2026-09-01'},
    homeTeam: {id: 1, name: 'Arsenal FC'},
    awayTeam: {id: 2, name: 'Inter'},
  };
  const fetcher = async (url) => {
    if (new URL(url).hostname.includes('api-sports')) {
      apCalls++;
      return Response.json({
        response: [],
        errors: {plan: 'Free plans do not have access to this season, try from 2022 to 2024.'},
        paging: {total: 1},
      });
    }
    return Response.json({matches: [fdMatch]});
  };
  const service = createService({
    env: {API_FOOTBALL_KEY: 'ap', FOOTBALL_DATA_ORG_KEY: 'fd'},
    store: createMemoryStore(),
    fetcher,
  });

  const first = await service.fixtures(params());
  assert.equal(first.source, 'football-data.org');
  assert.equal(first.fixtures.length, 1);
  assert.match(first.warnings[0], /plan limit/);
  assert.match(first.warnings[0], /2022 to 2024/);

  await service.fixtures(new URLSearchParams({from: '2026-10-14', to: '2026-10-14', x: '1'}));
  assert.equal(apCalls, 1, 'the plan restriction must not be retried against the provider');
});

function directProvider(handler) {
  let calls = [];
  const store = createMemoryStore();
  const now = () => Date.parse('2026-10-14T10:00:00Z');
  const storage = createStorage({store, now});
  const fetcher = async (url) => {
    calls.push(new URL(url).pathname);
    return handler(new URL(url).pathname);
  };
  const provider = createProviderClient({
    env: {FOOTBALL_DATA_ORG_KEY: 'fd'},
    store,
    fetcher,
    now,
    storage,
  });
  return {provider, calls: () => calls};
}

test('a 403 (resource not on the plan) blocks only that request, never the provider', async () => {
  const {provider, calls} = directProvider((path) =>
    path.includes('restricted')
      ? Response.json({message: 'The resource you are looking for is restricted'}, {status: 403})
      : Response.json({ok: true}),
  );
  await assert.rejects(
    () => provider('fd', 'competitions/restricted/matches', 1000),
    /does not cover this request/,
  );
  // The same request is not retried against the provider...
  await assert.rejects(
    () => provider('fd', 'competitions/restricted/matches', 1000),
    /does not cover this request/,
  );
  assert.equal(calls().length, 1);
  // ...and other requests keep working immediately.
  assert.deepEqual((await provider('fd', 'competitions/CL/matches', 1000)).body, {ok: true});
});

test('a 404 or 400 affects only that request and does not pause the provider', async () => {
  const {provider} = directProvider((path) =>
    path.includes('missing') ? Response.json({}, {status: 404}) : Response.json({ok: true}),
  );
  await assert.rejects(() => provider('fd', 'matches/missing', 1000), /HTTP 404/);
  assert.deepEqual((await provider('fd', 'matches/1', 1000)).body, {ok: true});
});

test('rate limits (429) and bad keys (401) still pause the provider briefly', async () => {
  for (const status of [429, 401]) {
    const {provider, calls} = directProvider(() => Response.json({message: 'no'}, {status}));
    await assert.rejects(() => provider('fd', 'a', 1000), new RegExp('HTTP ' + status));
    await assert.rejects(() => provider('fd', 'b', 1000), /paused/);
    assert.equal(calls().length, 1);
  }
});
