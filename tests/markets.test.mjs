import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatrix,
  outcomeProbabilities,
  scoreMarkets,
  bettingMarkets,
  comboProbability,
  FIRST_HALF_SHARE,
} from '../server/scores.mjs';
import {combinedPrice, slipSummary} from '../server/value.mjs';
import {createService} from '../server/service.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';

const RATES = [1.6, 1.1];
const RHO = -0.08;
const pct = (x) => Math.round(x * 1000) / 10;
const matrix = buildMatrix(RATES[0], RATES[1], RHO);
const p = outcomeProbabilities(matrix).map(pct);
const forecast = () => ({
  home: 'Sevilla',
  away: 'Osasuna',
  p,
  scores: scoreMarkets(matrix, {rates: RATES, rho: RHO}),
});
const cell = (groups, groupId, cellId) =>
  groups
    .find((g) => g.id === groupId)
    ?.rows.flatMap((r) => r.cells)
    .find((c) => c.id === cellId);
const sum = (cells) => cells.reduce((s, c) => s + c.p, 0);

test('the score markets carry the goal rates and rho they were built from', () => {
  const s = scoreMarkets(matrix, {rates: RATES, rho: RHO});
  assert.deepEqual(s.rates, RATES);
  assert.equal(s.rho, RHO);
  assert.equal(scoreMarkets(matrix).rates, undefined, 'optional, so old records still work');
});

test('every market group is a complete book: its chances add up to 100', () => {
  const groups = bettingMarkets(forecast());
  const ids = groups.map((g) => g.id);
  for (const id of [
    'result',
    'doubleChance',
    'btts',
    'totals',
    'handicap',
    'halfFull',
    'firstHalfResult',
    'firstHalfTotals',
    'firstHalfBtts',
    'firstGoal',
    'correctScore',
  ])
    assert.ok(ids.includes(id), `group ${id}`);
  for (const g of groups) {
    for (const row of g.rows) {
      for (const c of row.cells) {
        assert.ok(c.p > 0 && c.p < 100, `${g.id} ${c.id} = ${c.p}%`);
        assert.equal(c.fair, Math.round((100 / c.p) * 100) / 100, `${g.id} fair odds`);
      }
    }
    if (g.id === 'doubleChance') continue; // three overlapping pairs add to 200
    if (g.id === 'correctScore') continue; // only the likeliest scores are listed
    const total = ['totals', 'firstHalfTotals', 'handicap'].includes(g.id)
      ? g.rows.map((r) => sum(r.cells)) // each line is its own book
      : [sum(g.rows.flatMap((r) => r.cells))];
    for (const t of total) assert.ok(Math.abs(t - 100) < 0.3, `${g.id} adds to ${t}`);
  }
});

test('the result and three-way handicap agree with the forecast and the Asian lines', () => {
  const f = forecast();
  const groups = bettingMarkets(f);
  assert.equal(cell(groups, 'result', 'result:0').p, p[0]);
  assert.equal(cell(groups, 'result', 'result:1').p, p[1]);
  assert.equal(cell(groups, 'doubleChance', 'dc:1X').p, Math.round((p[0] + p[1]) * 10) / 10);
  // Sporttip's "0:1" gives the away side a goal start: home must win by two, a one-goal win is X.
  const line = f.scores.handicaps.find((h) => h.line === -1);
  assert.equal(cell(groups, 'handicap', 'hcap:0:1:1').p, line.home);
  assert.equal(cell(groups, 'handicap', 'hcap:0:1:X').p, line.push);
  assert.equal(cell(groups, 'handicap', 'hcap:0:1:2').p, line.away);
  const plus = f.scores.handicaps.find((h) => h.line === 2);
  assert.equal(cell(groups, 'handicap', 'hcap:2:0:2').p, plus.away);
  assert.equal(cell(groups, 'correctScore', 'score:1:1').p, f.scores.grid[1][1]);
});

test('first-half markets use the first-half share of the goals; halftime/fulltime keeps the full-time chances', () => {
  const groups = bettingMarkets(forecast());
  const half = buildMatrix(RATES[0] * FIRST_HALF_SHARE, RATES[1] * FIRST_HALF_SHARE, RHO);
  const [h1] = outcomeProbabilities(half).map(pct);
  assert.equal(cell(groups, 'firstHalfResult', 'fh:result:0').p, h1);
  assert.ok(
    cell(groups, 'firstHalfTotals', 'fh:total:over:0.5').p <
      cell(groups, 'totals', 'total:over:0.5').p,
    'a goal before the break is less likely than a goal in the match',
  );
  const ht = groups.find((g) => g.id === 'halfFull').rows.flatMap((r) => r.cells);
  for (const ft of [0, 1, 2]) {
    const marginal = sum(ht.filter((c) => c.id.endsWith(':' + ft)));
    assert.ok(Math.abs(marginal - p[ft]) < 0.2, `HT/FT ending ${ft}: ${marginal} vs ${p[ft]}`);
  }
  const first = groups.find((g) => g.id === 'firstGoal').rows[0].cells;
  assert.equal(first.find((c) => c.id === 'first:none').p, forecast().scores.grid[0][0]);
  assert.ok(first.find((c) => c.id === 'first:0').p > first.find((c) => c.id === 'first:2').p);
});

test('a same-match combination is priced from the scorelines, not by multiplying', () => {
  const f = forecast();
  const groups = bettingMarkets(f);
  const draw = cell(groups, 'result', 'result:1').p;
  const btts = cell(groups, 'btts', 'btts:yes').p;
  const joint = comboProbability(['result:1', 'btts:yes'], f);
  // A draw with both scoring is 1-1, 2-2, 3-3…: more likely together than the product says.
  assert.ok(joint > (draw * btts) / 100, `${joint} > ${(draw * btts) / 100}`);
  const expected = [1, 2, 3, 4, 5, 6].reduce((s, k) => s + f.scores.grid[k][k], 0);
  assert.ok(Math.abs(joint - expected) < 0.2, `${joint} vs ${expected}`);
  assert.equal(comboProbability(['result:0', 'result:2'], f), 0, 'contradictory legs');
  assert.equal(
    comboProbability(['fh:result:0', 'btts:yes'], f),
    null,
    'first-half legs are not combinable',
  );
  assert.equal(comboProbability(['result:0'], f), cell(groups, 'result', 'result:0').p);
  assert.deepEqual(bettingMarkets({home: 'A', away: 'B', p}), [], 'nothing without goal rates');
});

test('a Kombiwette price is the product of the leg prices, with the boost on the winnings', () => {
  assert.equal(combinedPrice(['2.20', '1.68']), 3.7);
  assert.equal(combinedPrice([2, 2], 5), 4.15);
  assert.equal(combinedPrice(['2', ''], 5), null, 'every leg needs a price');
  assert.equal(combinedPrice([], 5), null);
  const s = slipSummary([45.5, 59.5], combinedPrice(['2.20', '1.68']));
  assert.equal(s.combinedOdds, 3.7);
  assert.ok(s.expectedValuePercent > 0);
});

test('the slip names its toss-up legs and warns when the whole slip is a long shot', async () => {
  const {slipHtml} = await import('../public/js/views/slip.js');
  const pick = (id, home, prob) => ({
    id,
    outcome: 0,
    forecast: {home, away: 'B', p: [prob, 100 - prob - 10, 10], kickoff: '2099-01-01T00:00:00Z'},
  });
  const legs = [
    pick('a', 'Alverca', 45.5),
    pick('b', 'Young Boys', 59.5),
    pick('c', 'Atlético', 78.7),
  ];
  const html = slipHtml(legs, '', {legOdds: {a: '2.20', b: '1.68', c: '1.27'}, boost: '5'});
  assert.match(html, /toss-up/);
  assert.match(html, /data-leg-odds="a"[^>]*value="2.20"/);
  assert.match(html, /Combined price 4\.88/); // 2.20 × 1.68 × 1.27 = 4.694; +5% on the winnings
  assert.doesNotMatch(html, /long shot/);
  const nine = Array.from({length: 9}, (_, i) => pick('p' + i, 'T' + i, 60));
  assert.match(slipHtml(nine, ''), /long shot/);
});

test('the Sporttip-style block renders every group with an "at least" price, escaped', async () => {
  const {marketsBlockForTest} = await import('../public/js/views/markets.js');
  const html = marketsBlockForTest({...forecast(), home: '<b>Evil</b>'});
  assert.ok(!html.includes('<b>Evil'));
  assert.match(html, /Halftime \/ Fulltime/);
  assert.match(html, /1st half – Over\/Under/);
  assert.match(html, /at least/);
  assert.match(html, /data-combo-add="btts:yes"/);
  assert.equal(marketsBlockForTest({home: 'A', away: 'B', p}), '');
});

test('a market-led forecast record carries the fitted goal rates for the browser', async () => {
  const kickoff = Date.parse('2026-10-26T20:00:00Z');
  const fetcher = async (url) => {
    const u = new URL(url);
    if (u.hostname.includes('api-sports')) {
      const response =
        u.pathname === '/leagues'
          ? [
              {
                league: {id: 140, name: 'La Liga', type: 'League'},
                country: {name: 'Spain'},
                seasons: [{current: true, year: 2026, coverage: {predictions: true}}],
              },
            ]
          : u.pathname === '/predictions'
            ? [{predictions: {percent: {home: '55%', draw: '25%', away: '20%'}}}]
            : [
                {
                  fixture: {id: 7, date: new Date(kickoff).toISOString(), status: {short: 'NS'}},
                  league: {id: 140, name: 'La Liga', season: 2026},
                  teams: {home: {name: 'Sevilla'}, away: {name: 'Osasuna'}},
                  goals: {},
                  score: {fulltime: {}},
                },
              ];
      return Response.json({response, errors: [], paging: {total: 1}});
    }
    if (u.pathname.includes('get_schedule'))
      return Response.json({
        data: {
          games: [
            {
              game_id: 'g1',
              starts_at: new Date(kickoff).toISOString(),
              home: {name: 'Sevilla'},
              away: {name: 'Osasuna'},
              line: {home_ml: -125, draw_ml: +250, away_ml: +380, total: 2.5},
            },
          ],
        },
      });
    return Response.json({data: {}});
  };
  const service = createService({
    env: {API_FOOTBALL_KEY: 'ap-test', STRIKERAPI_API_KEY: 'sa-test'},
    store: createMemoryStore(),
    fetcher,
    now: () => kickoff - 20 * 3_600_000,
  });
  const list = await service.fixtures(new URLSearchParams({from: '2026-10-26', league: 'ap:140'}));
  const f = await service.forecast('ap:7', list.listingId);
  assert.equal(f.scoresSource, 'market');
  assert.equal(f.scores.rates.length, 2);
  assert.ok(
    Math.abs(f.scores.rates[0] + f.scores.rates[1] - 2.5) < 0.2,
    'rates share the total line',
  );
  assert.equal(typeof f.scores.rho, 'number');
  assert.ok(bettingMarkets(f).length > 5);
});
