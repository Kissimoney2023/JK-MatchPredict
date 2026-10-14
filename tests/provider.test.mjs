import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../server/service.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';

const params = () => new URLSearchParams({from: '2026-10-14', to: '2026-10-14'});

test('provider failures explain the cause, and the cooldown repeats it', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({message: 'Invalid API key'}, {status: 403});
  };
  const service = createService({
    env: {API_FOOTBALL_KEY: 'secret-key'},
    store: createMemoryStore(),
    fetcher,
  });

  const first = await service.fixtures(params()).catch((e) => e);
  assert.match(first.message, /HTTP 403/);
  assert.match(first.message, /Invalid API key/);
  assert.doesNotMatch(first.message, /secret-key/);

  const second = await service.fixtures(params()).catch((e) => e);
  assert.match(second.message, /Invalid API key/);
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
