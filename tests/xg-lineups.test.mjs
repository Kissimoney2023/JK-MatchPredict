import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTeamStats} from '../server/service/strikerapi.mjs';
import {createLineups, parseLineups} from '../server/service/lineups.mjs';
import {createStorage} from '../server/service/storage.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {createService} from '../server/service.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const MIN = 60_000;
const kickoff = '2026-10-14T20:00:00Z';

test('team stats rows are read defensively', () => {
  const s = parseTeamStats({
    name: 'Arsenal',
    games: 8,
    xg_for: '1.9',
    xg_against: 0.8,
    goals_for: 2.1,
    goals_against: 0.6,
  });
  assert.deepEqual(
    [s.name, s.games, s.xgFor, s.xgAgainst, s.goalsFor, s.goalsAgainst],
    ['Arsenal', 8, 1.9, 0.8, 2.1, 0.6],
  );
  assert.equal(parseTeamStats({team: 'X', xg: 1.2, xga: 1.1}).xgFor, 1.2);
  assert.equal(
    parseTeamStats({name: 'No xG', goals_for: 1}),
    null,
    'without xG there is nothing to show',
  );
  assert.equal(parseTeamStats(null), null);
});

test('line-ups parse once both sides name at least seven starters', () => {
  const side = (n) => ({
    formation: '4-3-3',
    starters: Array.from({length: n}, (_, i) => ({name: 'P' + i, position: 'MF', number: i + 1})),
  });
  const full = parseLineups({home: side(11), away: side(11)});
  assert.equal(full.home.starters.length, 11);
  assert.equal(full.home.formation, '4-3-3');
  assert.equal(full.away.starters[0].number, 1);
  assert.equal(parseLineups({home: side(11), away: side(3)}), null, 'away not named yet');
  assert.equal(parseLineups({home: {starters: []}, away: {starters: []}}), null);
  assert.equal(parseLineups(null), null);
  // Alternative shapes and bench entries.
  const alt = parseLineups({
    home_team: {starting_xi: Array.from({length: 11}, (_, i) => ({player: 'H' + i}))},
    away_team: {
      lineup: [
        ...Array.from({length: 11}, (_, i) => ({name: 'A' + i})),
        {name: 'Sub', substitute: true},
      ],
    },
  });
  assert.equal(alt.home.starters.length, 11);
  assert.equal(alt.away.starters.length, 11);
  assert.ok(!alt.away.starters.some((p) => p.name === 'Sub'));
});

/** A world with StrikerAPI team stats, a schedule with a game id and line-ups that appear late. */
function setup() {
  let clock = base;
  let named = false;
  const calls = [];
  const apRaw = {
    fixture: {id: 100, date: kickoff, status: {short: 'NS'}},
    league: {id: 39, name: 'Premier League', season: 2026},
    teams: {home: {name: 'Arsenal'}, away: {name: 'Chelsea'}},
    goals: {home: null, away: null},
    score: {fulltime: {home: null, away: null}},
  };
  const starters = (prefix) =>
    Array.from({length: 11}, (_, i) => ({
      name: `${prefix} ${i + 1}`,
      position: i ? 'MF' : 'GK',
      number: i + 1,
    }));
  const fetcher = async (url, opts) => {
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
    calls.push(u.pathname);
    if (u.pathname.includes('get_schedule'))
      return Response.json({
        data: {
          games: [
            {
              game_id: 'g9',
              starts_at: kickoff,
              home: {name: 'Arsenal'},
              away: {name: 'Chelsea'},
              line: {home_ml: -110, draw_ml: +260, away_ml: +300, total: 2.75},
            },
          ],
        },
      });
    if (u.pathname.includes('get_team_stats'))
      return Response.json({
        data: {
          stats: [
            {
              name: 'Arsenal',
              games: 8,
              xg_for: 1.9,
              xg_against: 0.8,
              goals_for: 2.1,
              goals_against: 0.6,
            },
            {
              name: 'Chelsea',
              games: 8,
              xg_for: 1.4,
              xg_against: 1.3,
              goals_for: 1.0,
              goals_against: 1.5,
            },
          ],
        },
      });
    if (u.pathname.includes('get_lineups')) {
      assert.equal(JSON.parse(opts.body).game_id, 'g9');
      return Response.json({
        data: named
          ? {
              home: {formation: '4-3-3', starters: starters('Gunner')},
              away: {formation: '3-4-3', starters: starters('Blue')},
            }
          : {home: {}, away: {}},
      });
    }
    return Response.json({data: {}});
  };
  const store = createMemoryStore();
  const service = createService({
    env: {API_FOOTBALL_KEY: 'ap-test', STRIKERAPI_API_KEY: 'sa-test'},
    store,
    fetcher,
    now: () => clock,
  });
  return {service, store, calls, setTime: (t) => (clock = t), name: () => (named = true)};
}

async function open(x) {
  const list = await x.service.fixtures(new URLSearchParams({from: '2026-10-14', league: 'ap:39'}));
  const f = await x.service.forecast('ap:100', list.listingId);
  return {f, listingId: list.listingId};
}

test('the analysis insights carry xG for both clubs from one league call', async () => {
  const x = setup();
  const {listingId} = await open(x);
  const insights = await x.service.insights('ap:100', listingId);
  assert.equal(insights.xg.home.xgFor, 1.9);
  assert.equal(insights.xg.away.xgAgainst, 1.3);
  assert.equal(insights.xg.home.games, 8);
  const statCalls = x.calls.filter((c) => c.includes('get_team_stats')).length;
  await x.service.insights('ap:100', listingId);
  assert.equal(
    x.calls.filter((c) => c.includes('get_team_stats')).length,
    statCalls,
    'cached for days',
  );
  assert.equal(insights.lineups, null, 'nothing named yet');
});

test('line-ups are fetched for picked matches near kickoff, retried until named, then shown', async () => {
  const x = setup();
  const {f, listingId} = await open(x);
  await x.service.save('browser-a', f.forecastId, 0);
  const lineupCalls = () => x.calls.filter((c) => c.includes('get_lineups')).length;

  // Too early: no spend.
  let run = await x.service.lineups.capture();
  assert.equal(run.due, 0);
  assert.equal(lineupCalls(), 0);

  // 70 minutes before kickoff, not yet named: one attempt, nothing stored.
  x.setTime(Date.parse(kickoff) - 70 * MIN);
  run = await x.service.lineups.capture();
  assert.deepEqual([run.due, run.fetched, run.captured], [1, 1, 0]);
  assert.equal(lineupCalls(), 1);
  assert.equal((await x.service.insights('ap:100', listingId)).lineups, null);

  // Fifteen minutes later the teams are named: the short cache lets the retry see them.
  x.name();
  x.setTime(Date.parse(kickoff) - 55 * MIN);
  run = await x.service.lineups.capture();
  assert.deepEqual([run.due, run.fetched, run.captured], [1, 1, 1]);
  assert.equal(lineupCalls(), 2);

  const again = await x.service.lineups.capture();
  assert.equal(again.fetched, 0, 'already stored: no further spend');
  const insights = await x.service.insights('ap:100', listingId);
  assert.equal(insights.lineups.home.formation, '4-3-3');
  assert.equal(insights.lineups.away.starters.length, 11);
  assert.equal(insights.lineups.home.starters[0].name, 'Gunner 1');
});

test('attempts are capped per match and nothing happens without StrikerAPI', async () => {
  const store = createMemoryStore();
  let clock = base;
  const storage = createStorage({store, now: () => clock});
  let asked = 0;
  const strikerApi = {
    enabled: () => true,
    gameIdFor: async () => ({gameId: 'g1', league: 'epl'}),
    lineups: async () => {
      asked++;
      return {body: {home: {}, away: {}}};
    },
  };
  await store.setJSON('clv/pending', {
    items: [
      {
        canonical: 'm1',
        home: 'A',
        away: 'B',
        kickoff: new Date(base + 30 * MIN).toISOString(),
        fdCode: 'PL',
      },
    ],
  });
  const lineups = createLineups({storage, strikerApi, now: () => clock});
  for (let i = 0; i < 5; i++) {
    await lineups.capture();
    clock += 10 * MIN;
  }
  assert.equal(asked, 3, 'three attempts, then it gives up');

  const off = createLineups({storage, strikerApi: {enabled: () => false}, now: () => clock});
  assert.deepEqual(await off.capture(), {due: 0, fetched: 0, captured: 0, errors: 0});
});

test('the page blocks render xG and line-ups, escaped', async () => {
  const {xgBlockForTest, lineupsBlockForTest} = await import('../public/js/views/insights.js');
  const names = {home: '<b>Evil</b>', away: 'Ok'};
  const xg = xgBlockForTest(
    {home: {games: 12, xgFor: 1.9, xgAgainst: 0.8, goalsFor: 2.4, goalsAgainst: 0.6}, away: null},
    names,
  );
  assert.ok(!xg.includes('<b>Evil'));
  assert.match(xg, /1\.90 \/ 0\.80/);
  assert.match(xg, /scoring well above its chances/);
  assert.match(xg, /not in this competition/);
  const few = xgBlockForTest(
    {home: {games: 4, xgFor: 1, xgAgainst: 1, goalsFor: 2, goalsAgainst: 0.5}, away: null},
    names,
  );
  assert.match(few, /too few matches to call luck/);
  assert.equal(xgBlockForTest(null, names), '');
  const l = lineupsBlockForTest(
    {
      home: {formation: '4-3-3', starters: [{name: '<i>x</i>', position: 'GK', number: 1}]},
      away: {formation: null, starters: [{name: 'B', position: null, number: null}]},
    },
    names,
  );
  assert.ok(!l.includes('<i>x'));
  assert.match(l, /4-3-3/);
  assert.match(l, /Confirmed line-ups/);
});
