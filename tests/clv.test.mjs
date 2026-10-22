import test from 'node:test';
import assert from 'node:assert/strict';
import {closingLineValue, selectionChance} from '../server/service/clv.mjs';
import {closingLineSummary, summarizePicks} from '../server/pickstats.mjs';
import {createService} from '../server/service.mjs';
import {makePrefetchHandler} from '../server/handler.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const MIN = 60_000;
const kickoff = '2026-10-14T20:00:00Z';

// ---------- the arithmetic ----------

test('a selection reads its chance from a consensus snapshot', () => {
  const snapshot = {p: [48.2, 26.5, 25.3], total: 2.75};
  assert.equal(selectionChance(snapshot, {outcome: 0}), 48.2);
  assert.equal(selectionChance(snapshot, {outcome: 2}), 25.3);
  const over = selectionChance(snapshot, {market: 'totals', line: 2.5, outcome: 0});
  assert.ok(over > 50 && over < 65);
  const under = selectionChance(snapshot, {market: 'totals', line: 2.5, outcome: 1});
  assert.ok(Math.abs(over + under - 100) < 0.11);
  assert.equal(
    selectionChance({p: [48, 27, 25], total: null}, {market: 'totals', line: 2.5, outcome: 0}),
    null,
  );
  assert.equal(selectionChance(null, {outcome: 0}), null);
});

test('closing line value is close over open, minus one', () => {
  const pick = {outcome: 0, forecast: {marketSnapshot: {p: [48, 27, 25]}}};
  const clv = closingLineValue(pick, {p: [51, 26, 23], at: 5});
  assert.equal(clv.open, 48);
  assert.equal(clv.close, 51);
  assert.equal(clv.value, 0.063);
  assert.equal(clv.beatClose, true);
  const worse = closingLineValue(pick, {p: [45, 28, 27]});
  assert.ok(Math.abs(worse.value + 0.0625) < 0.002);
  assert.equal(worse.beatClose, false);
  assert.equal(closingLineValue({outcome: 0, forecast: {}}, {p: [51, 26, 23]}), null, 'no opening');
  assert.equal(closingLineValue(pick, null), null, 'no close');
});

test('the summary averages value and counts beats; picks without a close are left out', () => {
  const picks = [
    {clv: {value: 0.1, beatClose: true}},
    {clv: {value: -0.02, beatClose: false}},
    {clv: {value: 0.04, beatClose: true}},
    {},
    {clv: null},
  ];
  const s = closingLineSummary(picks);
  assert.deepEqual(s, {n: 3, averageValue: 0.04, beatClose: 2, beatCloseRate: 0.667});
  assert.equal(closingLineSummary([{}]), null);
  assert.equal(summarizePicks([]).closingLine, null);
});

// ---------- through the service: open at pick time, close before kickoff ----------

function setup() {
  let clock = base;
  let line = {home_ml: -110, draw_ml: +260, away_ml: +300, total: 2.75, books: 8};
  const scheduleCalls = [];
  const apRaw = {
    fixture: {id: 100, date: kickoff, status: {short: 'NS'}},
    league: {id: 39, name: 'Premier League', season: 2026},
    teams: {home: {name: 'Arsenal'}, away: {name: 'Chelsea'}},
    goals: {home: null, away: null},
    score: {fulltime: {home: null, away: null}},
  };
  const fetcher = async (url) => {
    const u = new URL(url);
    if (u.hostname.includes('api-sports')) {
      const response =
        u.pathname === '/leagues'
          ? [
              {
                league: {id: 39, name: 'Premier League', type: 'League'},
                country: {name: 'England'},
                seasons: [{current: true, year: 2026, coverage: {predictions: true}}],
              },
            ]
          : u.pathname === '/predictions'
            ? [{predictions: {percent: {home: '55%', draw: '25%', away: '20%'}}}]
            : [apRaw];
      return Response.json({response, errors: [], paging: {total: 1}});
    }
    if (u.pathname.includes('get_schedule')) {
      scheduleCalls.push(clock);
      return Response.json({
        data: {
          games: [
            {
              game_id: 'g1',
              starts_at: kickoff,
              home: {name: 'Arsenal'},
              away: {name: 'Chelsea'},
              line,
            },
          ],
        },
      });
    }
    return Response.json({data: {}});
  };
  const store = createMemoryStore();
  const service = createService({
    env: {API_FOOTBALL_KEY: 'ap-test', STRIKERAPI_API_KEY: 'sa-test', CRON_SECRET: 's'},
    store,
    fetcher,
    now: () => clock,
  });
  return {
    service,
    store,
    scheduleCalls,
    setTime: (t) => (clock = t),
    moveLine: (next) => (line = next),
  };
}

async function openAndPick(x, sid = 'browser-a') {
  const list = await x.service.fixtures(new URLSearchParams({from: '2026-10-14', league: 'ap:39'}));
  const f = await x.service.forecast('ap:100', list.listingId);
  await x.service.save(sid, f.forecastId, 0);
  await x.service.save(sid, f.forecastId, 0, 'totals', 2.5);
  return f;
}

test('a forecast freezes the consensus; the close is captured before kickoff and read back', async () => {
  const x = setup();
  const f = await openAndPick(x);
  assert.ok(f.marketSnapshot?.p, 'the consensus snapshot is on the forecast');
  assert.equal(f.marketSnapshot.total, 2.75);
  assert.equal(f.canonical.includes('arsenal'), true);
  const pending = await x.store.get('clv/pending', {type: 'json'});
  assert.equal(pending.items.length, 1, 'one match noted, not one per pick');

  // Too early: nothing happens and no credits are spent.
  const early = await x.service.clv.captureClosings();
  assert.equal(early.due, 0);
  const callsBefore = x.scheduleCalls.length;

  // The market drifts toward Arsenal; 60 minutes before kickoff the close is recorded.
  x.moveLine({home_ml: -140, draw_ml: +275, away_ml: +340, total: 3, books: 8});
  x.setTime(Date.parse(kickoff) - 60 * MIN);
  const run = await x.service.clv.captureClosings();
  assert.equal(run.due, 1);
  assert.equal(run.captured, 1);
  assert.equal(run.leagues, 1);
  assert.equal(x.scheduleCalls.length, callsBefore + 1, 'one fresh schedule for the league');
  assert.equal((await x.store.get('clv/pending', {type: 'json'})).items.length, 0);

  const picks = await x.service.picks('browser-a');
  const result = picks.find((p) => !p.market);
  const totals = picks.find((p) => p.market === 'totals');
  assert.ok(result.clv, 'result pick carries closing line value');
  assert.ok(result.clv.close > result.clv.open, 'the market moved toward Arsenal');
  assert.equal(result.clv.beatClose, true);
  assert.ok(result.clv.value > 0);
  assert.ok(totals.clv, 'the over 2.5 pick too, from the total line');
  assert.ok(totals.clv.close > totals.clv.open, 'a higher total favours over');

  const stats = (await import('../server/pickstats.mjs')).summarizePicks(picks);
  assert.equal(stats.closingLine.n, 2);
  assert.equal(stats.closingLine.beatClose, 2);

  // A second run has nothing left to do.
  const again = await x.service.clv.captureClosings();
  assert.equal(again.due, 0);
});

test('a second person picking the same match shares the stored close', async () => {
  const x = setup();
  await openAndPick(x, 'browser-a');
  await openAndPick(x, 'browser-b');
  x.setTime(Date.parse(kickoff) - 30 * MIN);
  await x.service.clv.captureClosings();
  const b = await x.service.picks('browser-b');
  assert.ok(b.every((p) => p.clv));
});

test('without StrikerAPI there is no snapshot, no bookkeeping and no value', async () => {
  const store = createMemoryStore();
  const fetcher = async (url) => {
    const u = new URL(url);
    const response =
      u.pathname === '/leagues'
        ? [
            {
              league: {id: 39, name: 'Premier League', type: 'League'},
              country: {name: 'England'},
              seasons: [{current: true, year: 2026, coverage: {predictions: true}}],
            },
          ]
        : u.pathname === '/predictions'
          ? [{predictions: {percent: {home: '55%', draw: '25%', away: '20%'}}}]
          : [
              {
                fixture: {id: 100, date: kickoff, status: {short: 'NS'}},
                league: {id: 39, name: 'Premier League', season: 2026},
                teams: {home: {name: 'Arsenal'}, away: {name: 'Chelsea'}},
                goals: {},
                score: {fulltime: {}},
              },
            ];
    return Response.json({response, errors: [], paging: {total: 1}});
  };
  const service = createService({
    env: {API_FOOTBALL_KEY: 'ap-test'},
    store,
    fetcher,
    now: () => base,
  });
  const list = await service.fixtures(new URLSearchParams({from: '2026-10-14', league: 'ap:39'}));
  const f = await service.forecast('ap:100', list.listingId);
  assert.equal(f.marketSnapshot, null);
  await service.save('c', f.forecastId, 0);
  assert.equal(await store.get('clv/pending', {type: 'json'}), null);
  assert.deepEqual(await service.clv.captureClosings(), {
    due: 0,
    captured: 0,
    leagues: 0,
    errors: 0,
  });
  assert.equal((await service.picks('c'))[0].clv, undefined);
});

test('the scheduled job reports the closing-line step', async () => {
  const x = setup();
  const cron = makePrefetchHandler(
    () => ({
      ...x.service,
      reminders: {run: async () => ({sent: 0})},
      prefetch: async () => ({errors: []}),
      potd: {refresh: async () => ({skipped: true})},
    }),
    {CRON_SECRET: 's'},
  );
  const r = await cron(
    new Request('https://app.example/api/prefetch', {headers: {authorization: 'Bearer s'}}),
  );
  const body = await r.json();
  assert.deepEqual(body.clv, {due: 0, captured: 0, leagues: 0, errors: 0});
});
