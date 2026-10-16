import test from 'node:test';
import assert from 'node:assert/strict';
import {createPickOfTheDay} from '../server/service/potd.mjs';
import {createStorage} from '../server/service/storage.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {makeHandler} from '../server/handler.mjs';
import {analyze} from '../server/analysis.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const HOUR = 3_600_000;
const MIN = 60_000;

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

function setup({fixtureDays, forecasts, env = {}, gate}) {
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
      if (gate) await gate; // lets a test hold a computation open
      const result = forecasts[key];
      if (!result) throw new Error('no forecast');
      return result;
    },
  });
  return {potd, store, calls, advance: (ms) => (clock += ms)};
}

const TODAY = '2026-10-14';
const TOMORROW = '2026-10-15';
const keys = (result) => result.picks.map((p) => p.key);

test('the three clearest winners are chosen, best first', async () => {
  const x = setup({
    fixtureDays: {
      [TODAY]: [fx('a', 'PL', 5), fx('b', 'PD', 6), fx('c', 'CL', 8), fx('d', 'SA', 9)],
    },
    forecasts: {
      a: record([55, 25, 20]),
      b: record([72, 18, 10]),
      c: record([48, 27, 25]),
      d: record([10, 20, 70]), // an away win counts as a winner too
    },
  });
  await x.potd.refresh();
  const result = await x.potd.current();
  assert.deepEqual(keys(result), ['b', 'd', 'a']);
  assert.equal(result.picks[0].probability, 72);
  assert.equal(result.picks[0].predictedOutcome, 'Home win');
  assert.equal(result.picks[1].predictedOutcome, 'Away win');
  assert.equal(result.picks[0].listingId, 'listing-' + TODAY);
  assert.equal(result.checked, 4);
});

test('draws and matches with no clear favourite are never picked', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: [fx('draw', 'PL', 3), fx('tight', 'PD', 4), fx('ok', 'SA', 5)]},
    forecasts: {
      draw: record([20, 50, 30]), // a clear draw favourite is still not a winner pick
      tight: record([40, 30, 30]),
      ok: record([58, 24, 18]),
    },
  });
  await x.potd.refresh();
  assert.deepEqual(keys(await x.potd.current()), ['ok']);
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
  assert.deepEqual(keys(await x.potd.current()), ['near', 'ok']);
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
  assert.deepEqual(
    keys(await x.potd.current()),
    ['m7', 'm6', 'm5'],
    'the best of the checked ones',
  );
});

test('picks that kicked off drop out and the rest stay', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: [fx('first', 'PL', 2), fx('second', 'PL', 6), fx('third', 'PL', 8)]},
    forecasts: {
      first: record([70, 20, 10]),
      second: record([62, 22, 16]),
      third: record([58, 24, 18]),
    },
  });
  await x.potd.refresh();
  assert.deepEqual(keys(await x.potd.current()), ['first', 'second', 'third']);
  x.advance(3 * HOUR);
  assert.deepEqual(keys(await x.potd.current()), ['second', 'third']);
});

test('a scheduled result is not recomputed within six hours, and force recomputes', async () => {
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
  assert.ok(x.calls.forecasts.length > before);
});

test('a failed run keeps the previous result and never throws', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: [fx('a', 'PL', 20)]},
    forecasts: {a: record([70, 20, 10])},
  });
  await x.potd.refresh();
  const down = setup({
    fixtureDays: {[TODAY]: new Error('down'), [TOMORROW]: new Error('down')},
    forecasts: {},
  });
  assert.equal((await down.potd.refresh()).stored, false);
  assert.equal((await down.potd.current()).picks.length, 0);
  assert.deepEqual(keys(await x.potd.current()), ['a']);
});

// ---------- the first visit, before the scheduled job has run ----------

test('with nothing stored, the first visit works the picks out so the card is not empty', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: [fx('a', 'PL', 5), fx('b', 'PD', 6)]},
    forecasts: {a: record([60, 25, 15]), b: record([66, 20, 14])},
  });
  const first = await x.potd.current();
  assert.deepEqual(keys(first), ['b', 'a']);
  const calls = x.calls.forecasts.length;
  assert.deepEqual(keys(await x.potd.current()), ['b', 'a']);
  assert.equal(x.calls.forecasts.length, calls, 'the second visit only reads');
});

test('simultaneous first visits trigger one computation; the others are told it is under way', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const x = setup({
    gate,
    fixtureDays: {[TODAY]: [fx('a', 'PL', 5)]},
    forecasts: {a: record([62, 22, 16])},
  });
  const first = x.potd.current(); // starts computing and waits on the gate
  await new Promise((r) => setTimeout(r, 20));
  const second = await x.potd.current();
  assert.deepEqual(second, {picks: [], pending: true});
  release();
  assert.deepEqual(keys(await first), ['a']);
  assert.equal(x.calls.forecasts.length, 1, 'one computation only');
  assert.deepEqual(keys(await x.potd.current()), ['a']);
});

test('when nothing qualifies, visitors do not keep triggering lookups', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: [fx('a', 'PL', 5), fx('b', 'PD', 6)]},
    forecasts: {a: record([38, 31, 31]), b: record([36, 32, 32])},
  });
  assert.deepEqual(await x.potd.current(), {picks: [], pending: false});
  const calls = x.calls.forecasts.length;
  x.advance(30 * MIN);
  assert.deepEqual(await x.potd.current(), {picks: [], pending: false});
  assert.equal(x.calls.forecasts.length, calls, 'nothing qualified a moment ago: no new lookups');
});

test('with no data source at all, nothing is shown and nothing breaks', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: new Error('no key'), [TOMORROW]: new Error('no key')},
    forecasts: {},
  });
  assert.deepEqual(await x.potd.current(), {picks: [], pending: false});
});

test('the app exposes the stored picks', async () => {
  const x = setup({
    fixtureDays: {[TODAY]: [fx('a', 'PL', 5), fx('b', 'PD', 6)]},
    forecasts: {a: record([68, 20, 12]), b: record([61, 24, 15])},
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
  assert.deepEqual(keys(body), ['a', 'b']);
  assert.equal(body.picks[0].probability, 68);
  assert.equal(x.calls.forecasts.length, 2, 'only the scheduled computation called the provider');
});

// ---------- the dashboard card ----------

const sample = (overrides = {}) => ({
  key: 'ap:1',
  listingId: 'a'.repeat(64),
  home: 'Arsenal',
  away: 'Chelsea',
  competition: 'League',
  kickoff: '2026-10-20T19:00:00Z',
  predictedOutcome: 'Arsenal win',
  probability: 71.6,
  source: 'API-Football',
  ...overrides,
});

test('the card shows up to three picks, escaped, with the caveats', async () => {
  const {potdCards} = await import('../public/js/views/potd.js');
  const html = potdCards({
    checked: 5,
    picks: [
      sample({key: 'ap:1', home: '<img src=x onerror=alert(1)>', away: 'B"&C'}),
      sample({key: 'ap:2'}),
      sample({key: 'ap:3'}),
      sample({key: 'ap:4'}), // a fourth is never shown
    ],
  });
  assert.ok(!html.includes('<img src=x'), 'markup in names is escaped');
  assert.match(html, /&lt;img src=x/);
  assert.equal(html.match(/class="potd-pick"/g).length, 3);
  assert.match(html, /Top 3 picks to win today/);
  assert.match(html, /72%/);
  assert.match(html, /among 5 matches checked/);
  assert.match(html, /not certainties/);
  assert.match(html, /not betting advice/);
  assert.match(html, /data-analyze="ap:1" data-listing="a{64}"/);
  assert.ok(!html.includes('ap:4'));
});

test('the card title follows the number of picks', async () => {
  const {potdCards} = await import('../public/js/views/potd.js');
  assert.match(potdCards({checked: 1, picks: [sample()]}), /Top pick to win today/);
  assert.match(potdCards({checked: 3, picks: [sample(), sample({key: 'ap:2'})]}), /Top 2 picks/);
});
