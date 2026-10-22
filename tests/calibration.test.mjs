import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addResult,
  emptyAggregate,
  reliabilityChart,
  summarizeAggregate,
} from '../server/calibration.mjs';
import {summarize} from '../server/evaluation.mjs';
import {createCalibration, sourceKey} from '../server/service/calibration.mjs';
import {createStorage} from '../server/service/storage.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {createService} from '../server/service.mjs';
import {makeHandler} from '../server/handler.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('the running aggregate matches the backtest summary on the same matches', () => {
  const predictions = [];
  let seed = 7;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 300; i++) {
    const a = rand();
    const b = rand() * (1 - a);
    const p = [a, b, 1 - a - b];
    const r = rand();
    const outcome = r < p[0] ? 0 : r < p[0] + p[1] ? 1 : 2;
    predictions.push({p, outcome});
  }
  const batch = summarize(predictions);
  const agg = predictions.reduce((acc, x) => addResult(acc, x.p, x.outcome), emptyAggregate());
  const live = summarizeAggregate(agg);
  assert.equal(live.n, batch.n);
  close(live.logLoss, batch.logLoss, 1e-3, 'log loss');
  close(live.brier, batch.brier, 1e-3, 'brier');
  close(live.accuracy, batch.accuracy, 1e-3, 'accuracy');
  assert.equal(live.bins.length, batch.calibration.length);
  for (const [i, b] of live.bins.entries()) {
    assert.equal(b.range, batch.calibration[i].range);
    assert.equal(b.n, batch.calibration[i].n);
    close(b.observed, batch.calibration[i].observed, 1e-3, b.range);
  }
  assert.equal(live.small, false);
});

test('totals and outcome frequencies are tracked; bad input is ignored', () => {
  const agg = emptyAggregate();
  addResult(agg, [0.5, 0.3, 0.2], 0, 0.6, true);
  addResult(agg, [0.2, 0.3, 0.5], 2, 0.4, false);
  addResult(agg, [0.4, 0.4, 0.2], 1, null, null);
  addResult(agg, 'nope', 0);
  addResult(agg, [0.5, 0.5], 0);
  const s = summarizeAggregate(agg);
  assert.equal(s.n, 3);
  assert.equal(s.totals.n, 2);
  assert.equal(s.totals.happened, 0.5);
  close(s.totals.said, 0.5, 1e-9);
  assert.deepEqual(
    s.outcomes.map((o) => o.happened),
    [1 / 3, 1 / 3, 1 / 3].map((v) => Math.round(v * 10000) / 10000),
  );
  assert.equal(s.small, true);
  assert.deepEqual(summarizeAggregate(null), {n: 0});
});

test('the reliability chart draws only when enough bands are full, without inline styles', () => {
  const bins = [
    {range: '30-40%', predicted: 0.35, observed: 0.3, n: 12},
    {range: '40-50%', predicted: 0.45, observed: 0.5, n: 20},
    {range: '50-60%', predicted: 0.55, observed: 0.52, n: 9},
    {range: '60-70%', predicted: 0.64, observed: 0.7, n: 2},
  ];
  const svg = reliabilityChart(bins);
  assert.match(svg, /^<svg class="cal"/);
  assert.equal((svg.match(/<circle/g) || []).length, 3, 'the two-forecast band is not drawn');
  assert.match(svg, /cal-diagonal/);
  assert.ok(!/style=|<script|on\w+=/.test(svg));
  assert.equal(reliabilityChart(bins.slice(0, 2)), '');
  assert.equal(reliabilityChart(null), '');
});

test('sources are named from the forecast record', () => {
  assert.equal(sourceKey({modelVersion: 'market-shin-v1'}), 'market');
  assert.equal(sourceKey({modelVersion: 'jk-ratings-v2'}), 'ratings');
  assert.equal(sourceKey({modelVersion: 'jk-poisson-v1'}), 'legacy');
  assert.equal(sourceKey({source: 'API-Football'}), 'api-football');
});

// ---------- the service: log, settle, report ----------

const base = Date.parse('2026-10-14T10:00:00Z');
const HOUR = 3_600_000;

function setup() {
  let clock = base;
  const store = createMemoryStore();
  const storage = createStorage({store, now: () => clock});
  const scores = new Map(); // key -> {home, away} once finished
  const lookups = [];
  const lookup = {
    fresh: async (f) => {
      lookups.push(f.key);
      const s = scores.get(f.key);
      return {
        raw: s
          ? {fixture: {status: {short: 'FT'}}, score: {fulltime: s}}
          : {fixture: {status: {short: 'NS'}}, score: {fulltime: {}}},
      };
    },
  };
  const calibration = createCalibration({storage, now: () => clock, lookup});
  return {
    calibration,
    store,
    lookups,
    finish: (key, h, a) => scores.set(key, {home: h, away: a}),
    advance: (ms) => (clock += ms),
  };
}

const record = (
  key,
  p,
  {source = 'market-shin-v1', hours = 5, competition = 'CL', over = 55} = {},
) => ({
  canonical: 'match-' + key,
  key,
  provider: 'ap',
  fdCode: competition,
  canonicalLeague: competition,
  home: 'H' + key,
  away: 'A' + key,
  kickoff: new Date(base + hours * HOUR).toISOString(),
  p,
  modelVersion: source,
  goals: {lines: [{line: 2.5, over, under: 100 - over}]},
});

test('forecasts are logged once per match and source, latest wins, and settled into the record', async () => {
  const x = setup();
  await x.calibration.log(record('a', [60, 25, 15]));
  await x.calibration.log(record('a', [62, 24, 14])); // a later forecast of the same match
  await x.calibration.log(record('a', [50, 28, 22], {source: 'jk-ratings-v2'}));
  await x.calibration.log(record('b', [30, 30, 40], {competition: 'PL', over: 40}));
  const pending = await x.store.get('cal/pending', {type: 'json'});
  assert.equal(pending.items.length, 3);
  assert.deepEqual(
    pending.items.find((i) => i.canonical === 'match-a' && i.source === 'market').p,
    [62, 24, 14],
  );

  assert.equal((await x.calibration.settle()).due, 0, 'nothing is over yet');
  x.advance(8 * HOUR);
  const open = await x.calibration.settle();
  assert.equal(open.due, 3);
  assert.equal(open.lookups, 2, 'one lookup per match, shared by both sources');
  assert.equal(open.settled, 0, 'not finished');

  x.finish('a', 2, 1); // home win, 3 goals
  x.finish('b', 0, 0); // draw, 0 goals
  const done = await x.calibration.settle();
  assert.equal(done.settled, 3);
  assert.equal((await x.store.get('cal/pending', {type: 'json'})).items.length, 0);

  const report = await x.calibration.report();
  const market = report.sources.find((s) => s.key === 'market');
  assert.equal(market.n, 2);
  assert.equal(market.accuracy, 0.5, 'a right (62% home) and b wrong (40% away)');
  assert.equal(market.totals.n, 2);
  assert.equal(market.totals.happened, 0.5);
  const ratings = report.sources.find((s) => s.key === 'ratings');
  assert.equal(ratings.n, 1);
  assert.ok(
    report.competitions.some((c) => c.source === 'market' && c.competition === 'CL' && c.n === 1),
  );
  assert.ok(
    report.competitions.some((c) => c.source === 'market' && c.competition === 'PL' && c.n === 1),
  );
  assert.equal(report.awaiting, 0);
});

test('cancelled matches are dropped, lookups are capped, old entries expire', async () => {
  const x = setup();
  for (let i = 0; i < 9; i++) await x.calibration.log(record('m' + i, [50, 30, 20], {hours: 1}));
  x.advance(4 * HOUR);
  const run = await x.calibration.settle();
  assert.equal(run.lookups, 6, 'at most six lookups per run');

  const y = setup();
  await y.calibration.log(record('c', [50, 30, 20], {hours: 1}));
  y.advance(4 * HOUR);
  y.lookups.length = 0;
  // A cancelled match: the lookup says so and the record ignores it.
  const cancelled = createCalibration({
    storage: createStorage({store: y.store, now: () => base + 4 * HOUR}),
    now: () => base + 4 * HOUR,
    lookup: {fresh: async () => ({raw: {fixture: {status: {short: 'CANC'}}}})},
  });
  const r = await cancelled.settle();
  assert.equal(r.settled, 0);
  assert.equal(
    (await y.store.get('cal/pending', {type: 'json'})).items.length,
    0,
    'removed anyway',
  );
  assert.equal((await cancelled.report()).sources.length, 0);

  const z = setup();
  await z.calibration.log(record('old', [50, 30, 20], {hours: 1}));
  z.advance(6 * 24 * HOUR);
  await z.calibration.log(record('new', [50, 30, 20], {hours: 200}));
  assert.deepEqual(
    (await z.store.get('cal/pending', {type: 'json'})).items.map((i) => i.key),
    ['new'],
  );
});

test('the page renders the report, escaped, and the API serves it', async () => {
  const {calibrationHtml} = await import('../public/js/views/calibration.js');
  const empty = calibrationHtml({sources: [], competitions: [], awaiting: 3, updatedAt: null});
  assert.match(empty, /No forecast has been settled yet \(3 awaiting results\)/);
  const agg = emptyAggregate();
  for (let i = 0; i < 60; i++) addResult(agg, [0.55, 0.25, 0.2], i % 2 ? 0 : 2, 0.5, i % 3 === 0);
  const html = calibrationHtml({
    updatedAt: base,
    awaiting: 1,
    sources: [{key: 'market', label: '<b>x</b>', ...summarizeAggregate(agg)}],
    competitions: [{source: 'market', competition: 'CL', n: 60, accuracy: 0.5, logLoss: 0.9}],
  });
  assert.ok(!html.includes('<b>x'));
  assert.match(html, /60 settled matches/);
  assert.match(html, /Champions League/);
  assert.match(html, /Over 2\.5 goals/);

  const service = createService({
    env: {},
    store: createMemoryStore(),
    fetcher: async () => Response.json({}),
    now: () => base,
  });
  const handler = makeHandler(() => service, {});
  const r = await handler(new Request('https://app.example/api/football?action=calibration'));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {updatedAt: null, awaiting: 0, sources: [], competitions: []});
});
