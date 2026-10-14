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
