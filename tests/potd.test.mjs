import test from 'node:test';
import assert from 'node:assert/strict';
import {createPickOfTheDay} from '../server/service/potd.mjs';
import {createStorage} from '../server/service/storage.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {makeHandler} from '../server/handler.mjs';
import {analyze} from '../server/analysis.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const HOUR = 3_600_000;

const fx = (key, league, hoursAhead, extra = {}) => ({
  key,
  canonicalLeague: league,
  competition: league + ' competition',
  home: 'H' + key,
  away: 'A' + key,
  status: 'NS',
  kickoff: new Date(base + hoursAhead * HOUR).toISOString(),
  ...extra,
});

/** A forecast record shaped like the real one (analysis included). */
const record = (p) => {
  const f = {home: 'Home', away: 'Away', p, source: 'test model'};
  return {...f, analysis: analyze(f)};
};

function setup({fixtureDays, forecasts, env = {}}) {
  let clock = base;
  const store = createMemoryStore();
  const storage = createStorage({store, now: () => clock});
  const calls = {fixtures: [], forecasts: []};
  const potd = createPickOfTheDay({
    env,
    now: () => clock,
    storage,
    fixtures: async (params) => {
      calls.fixtures.push(params.get('from'));
      const items = fixtureDays[params.get('from')];
      if (items instanceof Error) throw items;
      return {fixtures: items ?? [], listingId: 'listing-' + params.get('from')};
    },
    forecast: async (key) => {
      calls.forecasts.push(key);
      const result = forecasts[key];
      if (!result) throw new Error('no forecast');
      return result;
    },
  });
  return {potd, store, calls, advance: (ms) => (clock += ms)};
}

const TODAY = '2026-10-14';
const TOMORROW = '2026-10-15';

test('the clearest favourite among the main competitions is chosen', async () => {
  const x = setup({
    fixtureDays: {
      [TODAY]: [fx('a', 'PL', 5), fx('b', 'PD', 6), fx('c', 'CL', 8)],
    },
    forecasts: {a: record([55, 25, 20]), b: record([72, 18, 10]), c: record([48, 27, 25])},
  });
  const result = await x.potd.refresh();
  assert.equal(result.stored, true);
  const {pick, checked, candidates} = await x.potd.current();
  assert.equal(pick.key, 'b');
  assert.equal(pick.probability, 72);
  assert.equal(pick.predictedOutcome, 'Home win');
  assert.equal(pick.listingId, 'listing-' + TODAY);
  assert.equal(pick.home, 'Hb');
  assert.equal(checked, 3);
  assert.equal(candidates, 3);
});

test('matches with no clear favourite are never the pick', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: [fx('a', 'PL', 5), fx('b', 'PD', 6)]},
    forecasts: {a: record([36, 32, 32]), b: record([40, 30, 30])},
  });
  await x.potd.refresh();
  assert.deepEqual(await x.potd.current(), {pick: null});
});

test('only open matches in the chosen competitions starting soon are considered', async () => {
  const x = setup({
    fixtureDays: {
      [TODAY]: [
        fx('live', 'PL', -1, {status: '1H'}),
        fx('finished', 'PL', -3, {status: 'FT'}),
        fx('minor', 'XYZ', 4), // a competition that is not in the list
        fx('ok', 'PL', 5),
      ],
      [TOMORROW]: [fx('far', 'PL', 40), fx('near', 'PL', 20)],
    },
    forecasts: {
      live: record([90, 5, 5]),
      finished: record([90, 5, 5]),
      minor: record([90, 5, 5]),
      far: record([90, 5, 5]),
      ok: record([60, 25, 15]),
      near: record([65, 20, 15]),
    },
  });
  await x.potd.refresh();
  assert.deepEqual(x.calls.forecasts.sort(), ['near', 'ok']);
  assert.equal((await x.potd.current()).pick.key, 'near');
});

test('the competitions are configurable and ordered by importance', async () => {
  const x = setup({
    env: {POTD_COMPETITIONS: 'sa, pl'},
    fixtureDays: {[TODAY]: [fx('pl', 'PL', 2), fx('sa', 'SA', 9), fx('pd', 'PD', 3)]},
    forecasts: {pl: record([60, 25, 15]), sa: record([61, 25, 14]), pd: record([80, 10, 10])},
  });
  await x.potd.refresh();
  assert.deepEqual(x.calls.forecasts, ['sa', 'pl'], 'SA first, then PL; PD is not configured');
});

test('forecasts are limited, and a failing forecast only removes that match', async () => {
  const many = Array.from({length: 12}, (_, i) => fx('m' + i, 'PL', 2 + i / 4));
  const forecasts = Object.fromEntries(many.map((m, i) => [m.key, record([50 + i, 25, 25 - i])]));
  delete forecasts.m0; // this one has no forecast
  const x = setup({fixtureDays: {[TODAY]: many}, forecasts});
  await x.potd.refresh();
  assert.equal(x.calls.forecasts.length, 8, 'at most eight forecasts are requested');
  const stored = await x.store.get('potd/current', {type: 'json'});
  assert.ok(stored.picks.length <= 3);
  assert.equal((await x.potd.current()).pick.key, 'm7', 'the best of the checked ones');
});

test('when the pick has started the next one is shown; nothing once all have', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: [fx('first', 'PL', 2), fx('second', 'PL', 6)]},
    forecasts: {first: record([70, 20, 10]), second: record([62, 22, 16])},
  });
  await x.potd.refresh();
  assert.equal((await x.potd.current()).pick.key, 'first');
  x.advance(3 * HOUR);
  assert.equal((await x.potd.current()).pick.key, 'second');
  x.advance(4 * HOUR);
  assert.deepEqual(await x.potd.current(), {pick: null});
});

test('a result is not recomputed within six hours, and old results are not shown', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: [fx('a', 'PL', 20)], [TOMORROW]: []},
    forecasts: {a: record([70, 20, 10])},
  });
  await x.potd.refresh();
  const before = x.calls.forecasts.length;
  x.advance(2 * HOUR);
  assert.deepEqual(await x.potd.refresh(), {skipped: true});
  assert.equal(x.calls.forecasts.length, before);
  await x.potd.refresh({force: true});
  assert.ok(x.calls.forecasts.length > before, 'force recomputes');

  x.advance(31 * HOUR);
  assert.deepEqual(await x.potd.current(), {pick: null}, 'a day-old result is hidden');
});

test('a failed run keeps the previous result and never throws', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: [fx('a', 'PL', 20)]},
    forecasts: {a: record([70, 20, 10])},
  });
  await x.potd.refresh();
  x.advance(7 * HOUR);
  // Everything fails this time: the providers are down.
  const down = setup({
    fixtureDays: {[TODAY]: new Error('down'), [TOMORROW]: new Error('down')},
    forecasts: {},
  });
  const result = await down.potd.refresh();
  assert.equal(result.stored, false);
  assert.deepEqual(await down.potd.current(), {pick: null});
  assert.equal((await x.potd.current()).pick.key, 'a');
});

test('the app exposes the stored pick, without any provider request', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: [fx('a', 'PL', 5)]},
    forecasts: {a: record([68, 20, 12])},
  });
  await x.potd.refresh();
  const handler = makeHandler(() => ({
    budget: async () => {},
    accounts: {resolve: async () => null},
    potd: x.potd,
  }));
  const response = await handler(new Request('https://app.example/api/football?action=potd'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pick.key, 'a');
  assert.equal(body.pick.probability, 68);
  assert.equal(x.calls.forecasts.length, 1, 'only the scheduled computation called the provider');
});

test('the dashboard card escapes team names and shows the caveats', async () => {
  const {potdCard} = await import('../public/js/views/potd.js');
  const html = potdCard({
    checked: 5,
    pick: {
      key: 'ap:1',
      listingId: 'a'.repeat(64),
      home: '<img src=x onerror=alert(1)>',
      away: 'B"&C',
      competition: 'League',
      kickoff: '2026-10-20T19:00:00Z',
      predictedOutcome: 'Home win',
      probability: 71.6,
      source: 'API-Football',
    },
  });
  assert.ok(!html.includes('<img src=x'), 'markup in names is escaped');
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /72%/);
  assert.match(html, /among 5 matches checked/);
  assert.match(html, /not a certainty/);
  assert.match(html, /not betting advice/);
  assert.match(html, /data-analyze="ap:1" data-listing="a{64}"/);
});
