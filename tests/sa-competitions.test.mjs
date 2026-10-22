import test from 'node:test';
import assert from 'node:assert/strict';
import {normSA, saStatus, saSettlementRaw, SA_ONLY_COMPETITIONS} from '../server/strikerapi.mjs';
import {finalScore} from '../server/model.mjs';
import {createService} from '../server/service.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const HOUR = 3_600_000;
const UEL = SA_ONLY_COMPETITIONS[0];

test('StrikerAPI games become the app’s fixtures, with statuses and scores read safely', () => {
  const upcoming = normSA(
    {
      game_id: 7,
      starts_at: '2026-10-16T18:45:00Z',
      status: 'scheduled',
      home: {name: 'Lille'},
      away: {name: 'Roma'},
      line: {},
    },
    UEL,
  );
  assert.equal(upcoming.key, 'sa:7');
  assert.equal(upcoming.provider, 'sa');
  assert.equal(upcoming.status, 'NS');
  assert.equal(upcoming.score, null);
  assert.equal(upcoming.fdCode, 'UEL');
  assert.equal(upcoming.competition, 'UEFA Europa League');
  const played = normSA(
    {
      game_id: '8',
      starts_at: '2026-10-02T18:45:00Z',
      status: 'final',
      home: {name: 'Lille', score: 2},
      away: {name: 'Roma', score: '1'},
    },
    UEL,
  );
  assert.equal(played.status, 'FT');
  assert.deepEqual(played.score, {home: 2, away: 1});
  assert.equal(
    normSA({game_id: 9, starts_at: 'never', home: {name: 'A'}, away: {name: 'B'}}, UEL),
    null,
  );
  assert.equal(
    normSA({starts_at: '2026-10-02T18:45:00Z', home: {name: 'A'}, away: {name: 'B'}}, UEL),
    null,
    'no id',
  );
  for (const [raw, status] of [
    ['scheduled', 'NS'],
    ['final', 'FT'],
    ['postponed', 'PST'],
    ['cancelled', 'CANC'],
    ['in_progress', '1H'],
    ['weird', 'TBD'],
    [undefined, 'NS'],
  ])
    assert.equal(saStatus(raw), status, String(raw));
  const settled = finalScore(
    saSettlementRaw({status: 'final', home: {score: 3}, away: {score: 0}}),
  );
  assert.deepEqual(settled, {home: 3, away: 0});
  assert.equal(finalScore(saSettlementRaw({status: 'scheduled', home: {}, away: {}})), null);
});

/** A world with no football API at all: StrikerAPI only. */
function setup({line = {home_ml: -120, draw_ml: +250, away_ml: +320, total: 2.5, books: 6}} = {}) {
  let clock = base;
  let finished = null; // [home, away] once the match is over
  const calls = [];
  const kickoff = new Date(base + 30 * HOUR).toISOString();
  const fetcher = async (url, opts) => {
    const u = new URL(url);
    const body = opts?.body ? JSON.parse(opts.body) : {};
    calls.push(`${u.pathname.split('/').pop()} ${body.league ?? ''}`.trim());
    if (u.pathname.includes('get_schedule'))
      return Response.json({
        data: {
          games: [
            {
              game_id: 'u1',
              starts_at: kickoff,
              status: finished ? 'final' : 'scheduled',
              home: {name: 'Lille'},
              away: {name: 'Roma'},
              line,
            },
            {
              game_id: 'u2',
              starts_at: new Date(base + 31 * HOUR).toISOString(),
              status: 'scheduled',
              home: {name: 'Porto'},
              away: {name: 'Nice'},
              line: null,
            },
          ],
        },
      });
    if (u.pathname.includes('list_games'))
      return Response.json({
        data: {
          games: [
            {
              game_id: 'u0',
              starts_at: new Date(base - 10 * HOUR).toISOString(),
              status: 'final',
              home: {name: 'Braga', score: 1},
              away: {name: 'Celtic', score: 1},
            },
            ...(finished
              ? [
                  {
                    game_id: 'u1',
                    starts_at: kickoff,
                    status: 'final',
                    home: {name: 'Lille', score: finished[0]},
                    away: {name: 'Roma', score: finished[1]},
                  },
                ]
              : []),
          ],
        },
      });
    if (u.pathname.includes('get_standings'))
      return Response.json({
        data: {
          standings: [
            {
              rank: 1,
              display_name: 'Lille',
              played: 2,
              wins: 2,
              draws: 0,
              losses: 0,
              goals_for: 5,
              goals_against: 1,
              goal_diff: 4,
              points: 6,
              group_name: 'League phase',
            },
          ],
        },
      });
    return Response.json({data: {}});
  };
  const service = createService({
    env: {STRIKERAPI_API_KEY: 'sa-test'},
    store: createMemoryStore(),
    fetcher,
    now: () => clock,
  });
  return {
    service,
    calls,
    kickoff,
    setTime: (t) => (clock = t),
    finish: (h, a) => (finished = [h, a]),
  };
}

test('the catalog lists the Europa and Conference League when only StrikerAPI is configured', async () => {
  const x = setup();
  const {leagues} = await x.service.catalog();
  const codes = leagues.map((l) => l.fdCode);
  assert.ok(codes.includes('UEL') && codes.includes('UECL'));
  const uel = leagues.find((l) => l.fdCode === 'UEL');
  assert.equal(uel.key, 'sa:uel');
  assert.equal(uel.saOnly, true);
  assert.equal(uel.source, 'StrikerAPI');
  assert.equal(uel.featured, true);
  // Without StrikerAPI they do not exist.
  const none = createService({
    env: {},
    store: createMemoryStore(),
    fetcher: async () => Response.json({}),
    now: () => base,
  });
  assert.equal((await none.catalog()).leagues.length, 0);
});

test('fixtures merge the schedule and the games list over a date range', async () => {
  const x = setup();
  const list = await x.service.fixtures(
    new URLSearchParams({league: 'sa:uel', from: '2026-10-13', to: '2026-10-16'}),
  );
  assert.equal(list.source, 'StrikerAPI');
  assert.deepEqual(
    list.fixtures.map((f) => f.key),
    ['sa:u0', 'sa:u1', 'sa:u2'],
  );
  assert.equal(list.fixtures[0].status, 'FT');
  assert.deepEqual(list.fixtures[0].score, {home: 1, away: 1});
  assert.equal(list.fixtures[1].status, 'NS');
  assert.match(list.warnings.join(' '), /bookmakers’ consensus only/);
  // A purely future range never asks for results.
  x.calls.length = 0;
  await x.service.fixtures(
    new URLSearchParams({league: 'sa:uel', from: '2026-10-16', to: '2026-10-20'}),
  );
  assert.ok(!x.calls.some((c) => c.startsWith('list_games')));
});

test('a Europa League match is forecast from its line, picked, and settled from the games list', async () => {
  const x = setup();
  const list = await x.service.fixtures(
    new URLSearchParams({league: 'sa:uel', from: '2026-10-14', to: '2026-10-16'}),
  );
  const f = await x.service.forecast('sa:u1', list.listingId);
  assert.equal(f.source, 'StrikerAPI · market consensus');
  assert.equal(f.p.length, 3);
  assert.ok(f.goals, 'Over/Under from the total line');
  assert.ok(f.scores, 'scores fitted to the line');
  await assert.rejects(() => x.service.forecast('sa:u2', list.listingId), /No bookmaker line yet/);

  assert.deepEqual(await x.service.save('fan', f.forecastId, 0), {saved: true});
  x.setTime(Date.parse(x.kickoff) + 3 * HOUR);
  x.finish(2, 0);
  const settled = await x.service.settlePicks('fan');
  assert.equal(settled.settled, 1);
  assert.equal((await x.service.picks('fan'))[0].result, 'correct');
});

test('standings for a StrikerAPI-only competition skip football-data.org', async () => {
  const x = setup();
  const table = await x.service.standings('sa:uel');
  assert.equal(table.source, 'StrikerAPI');
  assert.ok(table.groups.length >= 1);
  assert.ok(!x.calls.some((c) => c.includes('competitions')));
});
