import test from 'node:test';
import assert from 'node:assert/strict';
import {likelySelections, tierOf} from '../server/analysis.mjs';
import {buildMatrix, scoreMarkets} from '../server/scores.mjs';
import {createService} from '../server/service.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';

test('tiers follow the chance', () => {
  assert.equal(tierOf(93), 'very likely');
  assert.equal(tierOf(85), 'very likely');
  assert.equal(tierOf(72), 'likely');
  assert.equal(tierOf(60), 'lean');
  assert.equal(tierOf(48), 'toss-up');
});

test('the ladder ranks every priced selection, surest first, with fair odds', () => {
  const f = {
    home: 'Arsenal',
    away: 'Chelsea',
    p: [48.2, 26.5, 25.3],
    goals: {
      lines: [
        {line: 0.5, over: 93.6, under: 6.4},
        {line: 2.5, over: 52.4, under: 47.6},
      ],
      btts: 55,
    },
    scores: scoreMarkets(buildMatrix(1.71, 1.19, -0.12)),
  };
  const rows = likelySelections(f, {limit: 20});
  assert.equal(rows[0].selection, 'Over 0.5');
  assert.equal(rows[0].tier, 'very likely');
  assert.equal(rows[0].fairOdds, 1.07);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].p <= rows[i - 1].p, 'sorted');
  const dc = rows.find((r) => r.selection === 'Arsenal or draw (1X)');
  assert.equal(dc.p, 74.7);
  assert.equal(dc.tier, 'likely');
  const dnb = rows.find((r) => r.market === 'Draw no bet' && r.selection.startsWith('Arsenal'));
  assert.ok(dnb, 'draw no bet comes from the level handicap line');
  assert.ok(
    dnb.p > 48.2 && dnb.p < 75,
    `draw no bet ${dnb.p}% sits between the win and the double chance`,
  );
  assert.ok(rows.every((r) => r.p > 0 && r.p < 100));
  assert.equal(likelySelections(f).length, 8, 'the page shows eight');
  assert.deepEqual(likelySelections({home: 'A', away: 'B'}), []);
  // Without scores or goals, only results and double chances remain.
  const bare = likelySelections({home: 'A', away: 'B', p: [50, 30, 20]});
  assert.equal(bare.length, 6);
  assert.equal(bare[0].selection, 'A or draw (1X)');
});

test('the page block renders the ladder, escaped', async () => {
  const {likelyBlockForTest} = await import('../public/js/views/analysis.js');
  const html = likelyBlockForTest({home: '<b>Evil</b>', away: 'B', p: [60, 25, 15]});
  assert.ok(!html.includes('<b>Evil'));
  assert.match(html, /Most likely in this match/);
  assert.match(html, /tier-very-likely|tier-likely/);
  assert.match(html, /survive a draw/);
  assert.equal(likelyBlockForTest({home: 'A', away: 'B'}), '');
});

test('a forecast opened close to kickoff refreshes the league’s lines; far from it, the cached copy serves', async () => {
  const kickoff = Date.parse('2026-10-14T20:00:00Z');
  let clock = kickoff - 20 * 3_600_000; // 20 hours before
  const scheduleCalls = [];
  let line = {home_ml: -110, draw_ml: +260, away_ml: +300, total: 2.75};
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
            : [
                {
                  fixture: {id: 100, date: new Date(kickoff).toISOString(), status: {short: 'NS'}},
                  league: {id: 39, name: 'Premier League', season: 2026},
                  teams: {home: {name: 'Arsenal'}, away: {name: 'Chelsea'}},
                  goals: {},
                  score: {fulltime: {}},
                },
              ];
      return Response.json({response, errors: [], paging: {total: 1}});
    }
    if (u.pathname.includes('get_schedule')) {
      scheduleCalls.push(clock);
      return Response.json({
        data: {
          games: [
            {
              game_id: 'g1',
              starts_at: new Date(kickoff).toISOString(),
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
  const service = createService({
    env: {API_FOOTBALL_KEY: 'ap-test', STRIKERAPI_API_KEY: 'sa-test'},
    store: createMemoryStore(),
    fetcher,
    now: () => clock,
  });
  const list = await service.fixtures(new URLSearchParams({from: '2026-10-14', league: 'ap:39'}));
  const early = await service.forecast('ap:100', list.listingId);
  assert.equal(scheduleCalls.length, 1);

  // Five hours later (15 hours before kickoff): still the 12-hour cache.
  clock += 5 * 3_600_000;
  await service.forecast('ap:100', list.listingId);
  assert.equal(scheduleCalls.length, 1, 'far from kickoff the cached schedule serves');

  // Two hours before kickoff, the line has moved: the forecast refreshes and follows it.
  clock = kickoff - 2 * 3_600_000;
  line = {home_ml: -160, draw_ml: +280, away_ml: +380, total: 2.75};
  const late = await service.forecast('ap:100', list.listingId);
  assert.equal(scheduleCalls.length, 2, 'one refresh near kickoff');
  assert.ok(
    late.p[0] > early.p[0],
    `the home chance rose with the line: ${early.p[0]} -> ${late.p[0]}`,
  );

  // Another look an hour later reuses that refresh (two-hour freshness).
  clock = kickoff - 1 * 3_600_000;
  await service.forecast('ap:100', list.listingId);
  assert.equal(scheduleCalls.length, 2);
});
