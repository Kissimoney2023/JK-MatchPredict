import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../server/service.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';

/** A world with both football keys where API-Football has been switched off. */
function setup(env) {
  const hosts = [];
  const fetcher = async (url) => {
    const u = new URL(url);
    hosts.push(u.hostname);
    if (u.hostname.includes('football-data'))
      return Response.json({
        competitions: [
          {code: 'PL', name: 'Premier League', area: {name: 'England'}, type: 'LEAGUE'},
        ],
        matches: [],
      });
    return Response.json({response: [], errors: [], paging: {total: 0}});
  };
  const service = createService({
    env,
    store: createMemoryStore(),
    fetcher,
    now: () => Date.parse('2026-11-04T10:00:00Z'),
  });
  return {service, hosts};
}

test('API_FOOTBALL=off leaves API-Football out while its key stays set', async () => {
  const {service, hosts} = setup({
    API_FOOTBALL_KEY: 'ap-test',
    FOOTBALL_DATA_ORG_KEY: 'fd-test',
    API_FOOTBALL: 'off',
  });
  const s = service.status();
  const ap = s.providers.find((p) => p.name === 'API-Football');
  assert.equal(ap.configured, false);
  assert.equal(
    ap.disabled,
    true,
    'the status says it was switched off, not that the key is missing',
  );
  assert.equal(s.connected, true, 'football-data.org still connects the app');
  const {leagues, warnings} = await service.catalog();
  assert.ok(leagues.some((l) => l.fdCode === 'PL'));
  assert.ok(
    !hosts.some((h) => h.includes('api-sports')),
    `API-Football was never called: ${hosts}`,
  );
  assert.deepEqual(warnings, []);
  await service.fixtures(
    new URLSearchParams({league: 'fd:PL', from: '2026-11-04', to: '2026-11-10'}),
  );
  assert.ok(!hosts.some((h) => h.includes('api-sports')));
  // The setup check names the switch rather than reporting a missing key.
  const report = await service.diagnostics.run();
  const football = report.items.find((i) => i.id === 'football');
  assert.equal(football.state, 'ok');
  assert.match(football.detail, /API-Football is switched off/);
});

test('without the switch the key is used as before', () => {
  const {service} = setup({API_FOOTBALL_KEY: 'ap-test', FOOTBALL_DATA_ORG_KEY: 'fd-test'});
  const ap = service.status().providers.find((p) => p.name === 'API-Football');
  assert.equal(ap.configured, true);
  assert.equal(ap.disabled, undefined);
});
