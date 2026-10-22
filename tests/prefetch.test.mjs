import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../server/service.mjs';
import {makePrefetchHandler} from '../server/handler.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const DAY = 86_400_000;

// Four Champions League fixtures between eight different teams (ids 1..8).
const rawMatch = (i) => ({
  id: 100 + i,
  competition: {code: 'CL', name: 'UEFA Champions League'},
  utcDate: new Date(base + (i + 2) * DAY).toISOString(),
  status: 'TIMED',
  stage: 'LEAGUE_STAGE',
  season: {startDate: '2026-09-01'},
  homeTeam: {id: 2 * i + 1, name: `Team ${2 * i + 1} FC`},
  awayTeam: {id: 2 * i + 2, name: `Team ${2 * i + 2} FC`},
});
const matches = [0, 1, 2, 3].map(rawMatch);

const finished = (id, home, away, n) => ({
  id: 5000 + id * 100 + n,
  utcDate: new Date(base - (n + 1) * DAY).toISOString(),
  status: 'FINISHED',
  homeTeam: {id: home},
  awayTeam: {id: away},
  score: {duration: 'REGULAR', fullTime: {home: 2, away: 1}},
});
const history = (teamId) => [
  ...Array.from({length: 6}, (_, n) => finished(teamId, teamId, 99, n)),
  ...Array.from({length: 6}, (_, n) => finished(teamId, 99, teamId, n + 10)),
];

const standingsBody = {
  competition: {name: 'UEFA Champions League'},
  season: {startDate: '2026-09-01'},
  standings: [
    {
      type: 'TOTAL',
      group: null,
      table: [
        {
          position: 1,
          team: {name: 'Team 1 FC', shortName: 'Team 1'},
          playedGames: 3,
          won: 3,
          draw: 0,
          lost: 0,
          goalsFor: 9,
          goalsAgainst: 1,
          goalDifference: 8,
          points: 9,
        },
      ],
    },
    {type: 'HOME', group: null, table: [{position: 1, team: {name: 'Ignored'}}]},
  ],
};

function setup({fail = false} = {}) {
  let clock = base;
  const state = {calls: [], fail};
  const fetcher = async (url) => {
    const {pathname} = new URL(url);
    state.calls.push(pathname);
    if (state.fail) return Response.json({message: 'down'}, {status: 500});
    if (pathname === '/v4/competitions')
      return Response.json({
        competitions: [
          {
            code: 'CL',
            name: 'UEFA Champions League',
            area: {name: 'Europe'},
            currentSeason: {startDate: '2026-09-01'},
          },
        ],
      });
    if (pathname === '/v4/competitions/CL/matches') return Response.json({matches});
    if (pathname === '/v4/competitions/CL/standings') return Response.json(standingsBody);
    const team = pathname.match(/^\/v4\/teams\/(\d+)\/matches$/);
    if (team) return Response.json({matches: history(Number(team[1]))});
    const one = pathname.match(/^\/v4\/matches\/(\d+)$/);
    if (one) return Response.json(matches.find((m) => m.id === Number(one[1])));
    return Response.json({}, {status: 404});
  };
  const service = createService({
    env: {FOOTBALL_DATA_ORG_KEY: 'fd'},
    store: createMemoryStore(),
    fetcher,
    now: () => clock,
  });
  return {service, state, advance: (ms) => (clock += ms)};
}

const upcoming = () => new URLSearchParams({league: 'fd:CL', from: '2026-10-14', to: '2026-11-13'});
const teamCalls = (state) => state.calls.filter((p) => p.includes('/teams/')).length;

test('standings: only overall tables, normalised and cached', async () => {
  const {service, state} = setup();
  const s = await service.standings('fd:CL');
  assert.equal(s.competition, 'UEFA Champions League');
  assert.equal(s.groups.length, 1);
  assert.equal(s.groups[0].table[0].team, 'Team 1');
  assert.equal(s.groups[0].table[0].points, 9);

  const before = state.calls.length;
  await service.standings('fd:CL');
  assert.equal(state.calls.length, before, 'second read must come from the cache');
});

test('prefetch is budgeted per run and resumes where it stopped', async () => {
  const {service, state, advance} = setup();

  const first = await service.prefetch({maxFetches: 6});
  assert.equal(first.fetches, 6);
  assert.equal(first.budgetReached, true);
  assert.equal(first.competitions[0].standings, true);
  assert.equal(first.competitions[0].teamsWarmed, 3);
  assert.equal(first.competitions[0].teamsRemaining, 5);
  assert.equal(teamCalls(state), 3);

  advance(61_000); // new provider-rate window; earlier fetches stay cached
  const second = await service.prefetch({maxFetches: 6});
  assert.equal(second.competitions[0].teamsWarmed, 8);
  assert.equal(second.competitions[0].teamsRemaining, 0);
  assert.equal(second.fetches, 5);
  assert.equal(teamCalls(state), 8);
  assert.deepEqual(second.errors, []);
});

test('after a warm-up, a forecast needs no team-history requests', async () => {
  const {service, state, advance} = setup();
  await service.prefetch({maxFetches: 6});
  advance(61_000);
  await service.prefetch({maxFetches: 6});
  advance(61_000);

  const list = await service.fixtures(upcoming());
  assert.equal(list.fixtures.length, 4);
  const teamsBefore = teamCalls(state);

  const forecast = await service.forecast('fd:100', list.listingId);
  assert.equal(forecast.fallback, true);
  assert.equal(
    forecast.p.reduce((a, b) => a + b),
    100,
  );
  assert.equal(teamCalls(state), teamsBefore, 'histories must be served from the warmed cache');
});

test('a provider outage serves the last good fixtures with a notice', async () => {
  const {service, state, advance} = setup();
  const good = await service.fixtures(upcoming());
  assert.equal(good.fixtures.length, 4);

  advance(60 * 60_000); // past the 30-minute cache lifetime
  state.fail = true;
  const stale = await service.fixtures(upcoming());
  assert.equal(stale.fixtures.length, 4);
  assert.ok(stale.warnings.some((w) => /saved data/.test(w)));
});

test('prefetch endpoint requires the cron secret', async () => {
  const deps = () => ({
    prefetch: async () => ({ok: true}),
    reminders: {run: async () => ({sent: 0})},
    potd: {refresh: async () => ({skipped: true})},
    clv: {captureClosings: async () => ({due: 0})},
    diagnostics: {recordRun: async () => {}},
  });
  const request = (auth) =>
    new Request('https://app.example/api/prefetch', {
      headers: auth ? {authorization: auth} : {},
    });

  assert.equal((await makePrefetchHandler(deps, {})(request())).status, 503);
  const handler = makePrefetchHandler(deps, {CRON_SECRET: 's3cret'});
  assert.equal((await handler(request())).status, 401);
  assert.equal((await handler(request('Bearer wrong'))).status, 401);
  const ok = await handler(request('Bearer s3cret'));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {
    ok: true,
    reminders: {sent: 0},
    clv: {due: 0},
    potd: {skipped: true},
  });
});

test('a warmed cache lets the forecast rate teams using the whole fixture list', async () => {
  const {service, advance} = setup();
  await service.prefetch({maxFetches: 6});
  advance(61_000);
  await service.prefetch({maxFetches: 6});
  advance(61_000);

  const list = await service.fixtures(upcoming());
  const forecast = await service.forecast('fd:100', list.listingId);
  assert.equal(forecast.modelVersion, 'jk-ratings-v2');
  // Eight fixture teams plus the shared opponent (id 99) are rated together.
  assert.equal(forecast.teamsRated, 9);
});

test('fixture cards get team form only once histories are cached; insights adds detail', async () => {
  const {service, advance} = setup();

  const cold = await service.fixtures(upcoming());
  assert.equal(cold.fixtures[0].form, undefined, 'no cached history yet, so no form');

  await service.prefetch({maxFetches: 6});
  advance(61_000);
  await service.prefetch({maxFetches: 6});
  advance(61_000);

  const warm = await service.fixtures(upcoming());
  assert.deepEqual(warm.fixtures[0].form.home, ['W', 'W', 'W', 'W', 'W']);
  assert.equal(
    warm.fixtures.every((f) => f.form.home && f.form.away),
    true,
  );

  const detail = await service.insights('fd:100', warm.listingId);
  assert.equal(detail.home.games.length, 5);
  assert.deepEqual(detail.home.record, {w: 5, d: 0, l: 0});
  assert.equal(detail.away.games.length, 5);
  assert.deepEqual(detail.headToHead.matches, []);

  await assert.rejects(() => service.insights('fd:999', warm.listingId), /browser/);
});
