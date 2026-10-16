import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../server/service.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const LISTING = 'a'.repeat(64);

const entry = (position, name, short, points) => ({
  position,
  team: {name, shortName: short},
  playedGames: 8,
  won: 5,
  draw: 2,
  lost: 1,
  goalsFor: 14,
  goalsAgainst: 6,
  goalDifference: 8,
  points,
});

async function setup({table, standingsFail = false, home = 'Arsenal', away = 'Chelsea'}) {
  const store = createMemoryStore();
  const fetcher = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/v4/competitions')
      return Response.json({
        competitions: [
          {
            code: 'PL',
            name: 'Premier League',
            area: {name: 'England'},
            currentSeason: {startDate: '2026-08-01'},
          },
        ],
      });
    if (u.pathname === '/v4/competitions/PL/standings') {
      if (standingsFail) return Response.json({}, {status: 500});
      return Response.json({
        competition: {name: 'Premier League'},
        season: {startDate: '2026-08-01'},
        standings: [{type: 'TOTAL', table}],
      });
    }
    return Response.json({matches: []}); // team histories
  };
  const service = createService({
    env: {FOOTBALL_DATA_ORG_KEY: 'fd-test'},
    store,
    fetcher,
    now: () => base,
  });
  await store.setJSON('listing/' + LISTING, {
    items: [
      {
        key: 'fd:200',
        provider: 'fd',
        leagueKey: 'fd:PL',
        fdCode: 'PL',
        home,
        away,
        homeTeamId: 11,
        awayTeamId: 22,
        kickoff: '2026-10-20T19:00:00Z',
      },
    ],
  });
  return service;
}

const TABLE = [
  entry(1, 'Liverpool FC', 'Liverpool', 19),
  entry(2, 'Arsenal FC', 'Arsenal', 17),
  entry(7, 'Chelsea FC', 'Chelsea', 12),
];

test('both teams are placed in the competition table', async () => {
  const service = await setup({table: TABLE});
  const {leaguePosition: p} = await service.insights('fd:200', LISTING);
  assert.equal(p.competition, 'Premier League');
  assert.equal(p.source, 'football-data.org');
  assert.deepEqual(
    [p.home.position, p.home.of, p.home.points, p.home.goalDifference],
    [2, 3, 17, 8],
  );
  assert.deepEqual([p.away.position, p.away.of, p.away.points], [7, 3, 12]);
});

test('a club missing from the table is skipped, not guessed', async () => {
  const service = await setup({table: TABLE, away: 'Brighton'});
  const {leaguePosition: p} = await service.insights('fd:200', LISTING);
  assert.equal(p.home.position, 2);
  assert.equal(p.away, null);
});

test('an ambiguous club name is left out rather than matched to the wrong team', async () => {
  const service = await setup({
    table: [
      entry(1, 'Real Madrid CF', 'Real Madrid', 20),
      entry(2, 'Club Atletico de Madrid', 'Atletico Madrid', 18),
      entry(3, 'Chelsea FC', 'Chelsea', 12),
    ],
    home: 'Madrid',
  });
  const {leaguePosition: p} = await service.insights('fd:200', LISTING);
  assert.equal(p.home, null, 'two clubs match "Madrid"');
  assert.equal(p.away.position, 3);
});

test('no table at all: the position is absent and the insights still load', async () => {
  const service = await setup({table: TABLE, standingsFail: true});
  const result = await service.insights('fd:200', LISTING);
  assert.equal(result.leaguePosition, null);
  assert.ok(result.stats, 'the rest of the insights are unaffected');
});

test('neither club found: no position block', async () => {
  const service = await setup({table: TABLE, home: 'Brighton', away: 'Wolves'});
  const result = await service.insights('fd:200', LISTING);
  assert.equal(result.leaguePosition, null);
});
