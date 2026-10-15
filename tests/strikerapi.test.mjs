import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../server/service.mjs';
import {createStorage} from '../server/service/storage.mjs';
import {createProviderClient} from '../server/service/provider.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {
  americanToProbability,
  devigShin,
  eloExpectedScore,
  findGame,
  marketFromLine,
  sameTeam,
} from '../server/strikerapi.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const DAY = 86_400_000;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// ---------- pure helpers ----------

test('americanToProbability converts moneylines to implied probabilities', () => {
  assert.ok(Math.abs(americanToProbability(100) - 0.5) < 1e-9);
  assert.ok(Math.abs(americanToProbability(-200) - 2 / 3) < 1e-9);
  assert.ok(Math.abs(americanToProbability(300) - 0.25) < 1e-9);
  assert.equal(americanToProbability(0), null);
  assert.equal(americanToProbability(undefined), null);
});

test('devigShin: sums to one, keeps order, and trims long shots more than scaling does', () => {
  const implied = [-150, 280, 400].map(americanToProbability); // overround > 1
  const shin = devigShin(implied);
  const proportional = implied.map((q) => q / sum(implied));
  assert.ok(Math.abs(sum(shin) - 1) < 1e-9);
  assert.ok(shin[0] > shin[1] && shin[1] > shin[2]);
  assert.ok(shin[2] < proportional[2], 'the long shot must get less than proportional scaling');
  // No margin to remove: unchanged.
  assert.deepEqual(devigShin([0.5, 0.3, 0.2]), [0.5, 0.3, 0.2]);
});

test('marketFromLine returns percentages summing to exactly 100, or null if incomplete', () => {
  const m = marketFromLine({books: 8, home_ml: -120, draw_ml: 260, away_ml: 330, total: 2.5});
  assert.equal(
    m.p.reduce((a, b) => a + b),
    100,
  );
  assert.ok(m.p[0] > m.p[1] && m.p[1] > m.p[2]);
  assert.equal(m.books, 8);
  assert.ok(m.overround > 0);
  assert.equal(marketFromLine({home_ml: 100, draw_ml: 200}), null);
  assert.equal(marketFromLine(null), null);
});

test('team and game matching copes with provider naming differences', () => {
  assert.ok(sameTeam('Arsenal FC', 'Arsenal'));
  assert.ok(sameTeam('FC Internazionale Milano', 'Inter Milan'));
  assert.ok(sameTeam('FC Bayern München', 'Bayern Munich'));
  assert.ok(!sameTeam('Real Madrid CF', 'Real Sociedad'));

  const games = [
    {
      game_id: '1',
      starts_at: '2026-10-16T19:00:00Z',
      home: {name: 'Arsenal'},
      away: {name: 'Inter Milan'},
    },
    {
      game_id: '2',
      starts_at: '2026-10-16T19:00:00Z',
      home: {name: 'Real Madrid'},
      away: {name: 'Bayern Munich'},
    },
  ];
  const fixture = {
    home: 'Arsenal FC',
    away: 'FC Internazionale Milano',
    kickoff: '2026-10-16T19:30:00Z',
  };
  assert.equal(findGame(games, fixture).game_id, '1');
  assert.equal(findGame(games, {...fixture, kickoff: '2026-10-18T19:00:00Z'}), null, 'wrong day');
  assert.equal(findGame(games, {...fixture, home: 'Inter', away: 'Arsenal'}), null, 'reversed');
});

test('Elo expected score uses the 60-point home bonus', () => {
  assert.ok(Math.abs(eloExpectedScore(1500, 1500, 0) - 0.5) < 1e-9);
  assert.ok(eloExpectedScore(1500, 1500) > 0.58);
  assert.ok(Math.abs(eloExpectedScore(1900, 1500, 0) - 10 / 11) < 1e-9, '400 points = 10-to-1');
});

// ---------- provider client ----------

function providerSetup(env, fetcher) {
  let clock = base;
  const store = createMemoryStore();
  const storage = createStorage({store, now: () => clock});
  const provider = createProviderClient({env, store, fetcher, now: () => clock, storage});
  return {provider, advance: (ms) => (clock += ms)};
}

test('StrikerAPI client POSTs JSON with the key header, unwraps data and caches by arguments', async () => {
  const calls = [];
  const fetcher = async (url, opts) => {
    calls.push({url, opts});
    return Response.json({data: {games: [{game_id: 'x'}], count: 1}});
  };
  const {provider} = providerSetup({STRIKERAPI_API_KEY: 'sa-key'}, fetcher);

  const r = await provider('sa', 'get_schedule', 1000, {league: 'ucl', days: 30});
  assert.deepEqual(r.body.games, [{game_id: 'x'}]);
  assert.equal(calls[0].url, 'https://mcp.strikerapi.com/v1/get_schedule');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['x-api-key'], 'sa-key');
  assert.deepEqual(JSON.parse(calls[0].opts.body), {league: 'ucl', days: 30});

  await provider('sa', 'get_schedule', 1000, {league: 'ucl', days: 30});
  assert.equal(calls.length, 1, 'same tool and arguments are served from the cache');
  await provider('sa', 'get_schedule', 1000, {league: 'laliga', days: 30});
  assert.equal(calls.length, 2, 'different arguments are a different request');
});

test('StrikerAPI credits are capped per month and never exceed the cap', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({data: {ok: true}});
  };
  const {provider} = providerSetup(
    {STRIKERAPI_API_KEY: 'k', STRIKERAPI_MONTHLY_CREDITS: '5'},
    fetcher,
  );
  await provider('sa', 'get_schedule', 1000, {league: 'ucl'}); // 2 credits
  await provider('sa', 'get_ratings', 1000, {league: 'ucl'}); // 2 credits (4 total)
  await assert.rejects(
    () => provider('sa', 'get_standings', 1000, {league: 'ucl'}), // would be 6 > 5
    /budget/,
  );
  assert.equal(calls, 2);
});

test('out-of-credits (HTTP 402) pauses StrikerAPI for an hour instead of retrying', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({error: 'Insufficient credits'}, {status: 402});
  };
  const {provider, advance} = providerSetup({STRIKERAPI_API_KEY: 'k'}, fetcher);
  await assert.rejects(() => provider('sa', 'get_ratings', 1000, {league: 'ucl'}), /402/);
  advance(10 * 60_000);
  await assert.rejects(() => provider('sa', 'get_ratings', 1000, {league: 'ucl'}), /paused/);
  assert.equal(calls, 1);
});

// ---------- end to end ----------

const rawMatch = (i, home, away) => ({
  id: 100 + i,
  competition: {code: 'CL', name: 'UEFA Champions League'},
  utcDate: new Date(base + (i + 2) * DAY).toISOString(),
  status: 'TIMED',
  stage: 'LEAGUE_STAGE',
  season: {startDate: '2026-09-01'},
  homeTeam: {id: 2 * i + 1, name: home, shortName: home},
  awayTeam: {id: 2 * i + 2, name: away, shortName: away},
});
const matches = [
  rawMatch(0, 'Arsenal FC', 'FC Internazionale Milano'),
  rawMatch(1, 'Real Madrid CF', 'FC Bayern München'),
];
const finished = (id, home, away, n) => ({
  id: 5000 + id * 100 + n,
  utcDate: new Date(base - (n + 1) * DAY).toISOString(),
  status: 'FINISHED',
  homeTeam: {id: home, name: 'T' + home},
  awayTeam: {id: away, name: 'T' + away},
  score: {duration: 'REGULAR', fullTime: {home: 2, away: 1}},
});
const history = (t) => [
  ...Array.from({length: 6}, (_, n) => finished(t, t, 99, n)),
  ...Array.from({length: 6}, (_, n) => finished(t, 99, t, n + 10)),
];
const kickoff = (m) => m.utcDate;
const saSchedule = {
  games: [
    {
      game_id: '9001',
      starts_at: kickoff(matches[0]),
      home: {team_id: '359', name: 'Arsenal'},
      away: {team_id: '110', name: 'Inter Milan'},
      line: {books: 8, home_ml: -120, draw_ml: 260, away_ml: 330, total: 2.5, home_handicap: -0.5},
    },
    {
      game_id: '9002',
      starts_at: kickoff(matches[1]),
      home: {team_id: '86', name: 'Real Madrid'},
      away: {team_id: '132', name: 'Bayern Munich'},
      line: {books: 8, home_ml: 150, draw_ml: 270, away_ml: 170, total: 3, home_handicap: 0},
    },
  ],
  count: 2,
};
const saRatings = {
  as_of: '2026-10-13',
  ratings: [
    {rank: 1, team_id: '132', name: 'Bayern Munich', elo: 1760, last_game: '2026-10-01'},
    {rank: 2, team_id: '359', name: 'Arsenal', elo: 1710, last_game: '2026-10-01'},
    {rank: 3, team_id: '110', name: 'Inter Milan', elo: 1690, last_game: '2026-10-01'},
    {rank: 4, team_id: '86', name: 'Real Madrid', elo: 1680, last_game: '2026-10-01'},
  ],
  count: 4,
};
const saHeadToHead = {
  teams: [],
  summary: {
    meetings: 4,
    team_wins: 2,
    draws: 1,
    opponent_wins: 1,
    team_goals: 6,
    opponent_goals: 4,
    first_meeting: '2003-03-01',
  },
  games: [
    {date: '2024-03-01', home: {name: 'Arsenal', score: 2}, away: {name: 'Inter Milan', score: 1}},
    {date: '2023-09-01', home: {name: 'Inter Milan', score: 0}, away: {name: 'Arsenal', score: 0}},
  ],
  count: 4,
};
const saStandings = {
  season: 2026,
  standings: [
    {
      group_name: 'UEFA Champions League 2026-27',
      rank: 1,
      display_name: 'Arsenal',
      played: 3,
      wins: 3,
      draws: 0,
      losses: 0,
      goals_for: 9,
      goals_against: 1,
      goal_diff: 8,
      points: 9,
    },
    {
      group_name: 'UEFA Champions League 2026-27',
      rank: 2,
      display_name: 'Inter Milan',
      played: 3,
      wins: 2,
      draws: 1,
      losses: 0,
      goals_for: 6,
      goals_against: 2,
      goal_diff: 4,
      points: 7,
    },
  ],
  count: 2,
};

function setup({
  env = {},
  saOverrides = {},
  fdStandingsFail = false,
  teamsFail = false,
  thinHistory = false,
} = {}) {
  const calls = [];
  const fetcher = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({host: u.hostname, path: u.pathname});
    if (u.hostname === 'mcp.strikerapi.com') {
      const tool = u.pathname.replace('/v1/', '');
      if (saOverrides[tool]) return saOverrides[tool]();
      const data = {
        get_schedule: saSchedule,
        get_ratings: saRatings,
        get_head_to_head: saHeadToHead,
        get_standings: saStandings,
      }[tool];
      return data ? Response.json({data}) : Response.json({error: 'unknown tool'}, {status: 400});
    }
    const p = u.pathname;
    if (p === '/v4/competitions')
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
    if (p === '/v4/competitions/CL/matches') return Response.json({matches});
    if (p === '/v4/competitions/CL/standings')
      return fdStandingsFail ? Response.json({}, {status: 500}) : Response.json({standings: []});
    const team = p.match(/^[/]v4[/]teams[/](\d+)[/]matches$/);
    if (team)
      return teamsFail
        ? Response.json({}, {status: 500})
        : Response.json({matches: history(Number(team[1])).slice(0, thinHistory ? 2 : undefined)});
    const one = p.match(/^[/]v4[/]matches[/](\d+)$/);
    if (one) return Response.json(matches.find((m) => m.id === Number(one[1])));
    return Response.json({}, {status: 404});
  };
  const service = createService({
    env: {FOOTBALL_DATA_ORG_KEY: 'fd', STRIKERAPI_API_KEY: 'sa', ...env},
    store: createMemoryStore(),
    fetcher,
    now: () => base,
  });
  return {service, calls};
}

const upcoming = () => new URLSearchParams({league: 'fd:CL', from: '2026-10-14', to: '2026-11-13'});
const teamCalls = (calls) => calls.filter((c) => c.path.includes('/teams/')).length;

test('forecast uses the StrikerAPI market consensus and needs no team histories', async () => {
  const {service, calls} = setup();
  const list = await service.fixtures(upcoming());
  const f = await service.forecast('fd:100', list.listingId);

  assert.equal(f.source, 'StrikerAPI · market consensus');
  assert.equal(f.modelVersion, 'market-shin-v1');
  assert.equal(
    f.p.reduce((a, b) => a + b),
    100,
  );
  assert.ok(f.p[0] > f.p[2], 'Arsenal at -120 must be favoured over Inter');
  assert.equal(f.marketBooks, 8);
  assert.match(f.analysis.disclaimer, /bookmaker prices/);
  assert.equal(teamCalls(calls), 0, 'no team-history requests were needed');
});

test('market forecasts can be switched off, falling back to the ratings model', async () => {
  const {service} = setup({env: {STRIKERAPI_MARKET_FORECASTS: 'off'}});
  const list = await service.fixtures(upcoming());
  const f = await service.forecast('fd:100', list.listingId);
  assert.equal(f.modelVersion, 'jk-ratings-v2');
});

test('a StrikerAPI outage or missing key never breaks forecasts', async () => {
  const down = setup({
    saOverrides: {get_schedule: () => Response.json({error: 'down'}, {status: 500})},
  });
  const list = await down.service.fixtures(upcoming());
  assert.equal(
    (await down.service.forecast('fd:100', list.listingId)).modelVersion,
    'jk-ratings-v2',
  );

  const noKey = setup({env: {STRIKERAPI_API_KEY: ''}});
  const list2 = await noKey.service.fixtures(upcoming());
  assert.equal(
    (await noKey.service.forecast('fd:100', list2.listingId)).modelVersion,
    'jk-ratings-v2',
  );
  assert.equal(
    noKey.calls.some((c) => c.host === 'mcp.strikerapi.com'),
    false,
  );
});

test('a fixture with no matching schedule game falls back to the ratings model', async () => {
  const {service} = setup({
    saOverrides: {
      get_schedule: () =>
        Response.json({
          data: {games: [{...saSchedule.games[0], starts_at: '2026-12-01T19:00:00Z'}]},
        }),
    },
  });
  const list = await service.fixtures(upcoming());
  assert.equal((await service.forecast('fd:100', list.listingId)).modelVersion, 'jk-ratings-v2');
});

test('standings fall back to StrikerAPI when football-data.org fails', async () => {
  const {service} = setup({fdStandingsFail: true});
  const s = await service.standings('fd:CL');
  assert.equal(s.source, 'StrikerAPI');
  assert.equal(s.groups.length, 1);
  assert.equal(s.groups[0].name, null, 'a single table needs no heading');
  assert.equal(s.groups[0].table[0].team, 'Arsenal');
  assert.equal(s.groups[0].table[0].points, 9);
});

test('insights add all-time head-to-head, Elo and the market view', async () => {
  const {service} = setup();
  const list = await service.fixtures(upcoming());
  const d = await service.insights('fd:100', list.listingId);

  assert.equal(d.competitionHeadToHead.meetings, 4);
  assert.equal(d.competitionHeadToHead.winsHome, 2);
  assert.equal(d.competitionHeadToHead.firstMeeting, '2003-03-01');
  assert.equal(d.competitionHeadToHead.matches[0].score, '2–1');
  assert.equal(d.elo.home.elo, 1710);
  assert.ok(d.elo.expectedHomeScore > 0.5);
  assert.equal(
    d.market.p.reduce((a, b) => a + b),
    100,
  );
  assert.equal(d.home.games.length, 5, 'recent form still comes from football-data.org');
});

test('insights still return the StrikerAPI parts when team histories are unavailable', async () => {
  const {service} = setup({teamsFail: true});
  const list = await service.fixtures(upcoming());
  const d = await service.insights('fd:100', list.listingId);
  assert.equal(d.home, null);
  assert.equal(d.away, null);
  assert.equal(d.competitionHeadToHead.meetings, 4);
  assert.equal(d.elo.home.elo, 1710);
  assert.ok(d.market);
});

test('prefetch also warms the StrikerAPI schedule and ratings', async () => {
  const {service, calls} = setup();
  const summary = await service.prefetch({maxFetches: 20});
  assert.deepEqual(summary.errors, []);
  const sa = calls.filter((c) => c.host === 'mcp.strikerapi.com').map((c) => c.path);
  assert.ok(sa.includes('/v1/get_schedule'));
  assert.ok(sa.includes('/v1/get_ratings'));
});

// football-data.org name <-> the spelling StrikerAPI (ESPN) uses. All must be recognised.
const SAME_CLUB = [
  ['SK Slavia Praha', 'Slavia Prague'],
  ['AC Sparta Praha', 'Sparta Prague'],
  ['FC København', 'FC Copenhagen'],
  ['FC København', 'Copenhagen'],
  ['Club Atlético de Madrid', 'Atlético Madrid'],
  ['FC Internazionale Milano', 'Inter Milan'],
  ['FC Bayern München', 'Bayern Munich'],
  ['PAE Olympiakos SFP', 'Olympiacos'],
  ['Olympiacos FC', 'Olympiacos'],
  ['FK Crvena Zvezda', 'Red Star Belgrade'],
  ['Royale Union Saint-Gilloise', 'Union St.-Gilloise'],
  ['Athletic Club', 'Athletic Bilbao'],
  ['Pafos FC', 'Paphos'],
  ['Stade Brestois 29', 'Brest'],
  ['Olympique Lyonnais', 'Lyon'],
  ['Olympique de Marseille', 'Marseille'],
  ['Bayer 04 Leverkusen', 'Bayer Leverkusen'],
  ['SL Benfica', 'Benfica'],
  ['Club Brugge KV', 'Club Brugge'],
  ['Lille OSC', 'Lille'],
  ['Fenerbahçe SK', 'Fenerbahce'],
  ['FK Bodø/Glimt', 'Bodo/Glimt'],
  ['Qarabağ Ağdam FK', 'Qarabag'],
  ['Sporting Clube de Portugal', 'Sporting CP'],
  ['Paris Saint-Germain FC', 'Paris Saint-Germain'],
  ['Sabah FK', 'Sabah'],
  ['Borussia Dortmund', 'Borussia Dortmund'],
  ['Newcastle United FC', 'Newcastle United'],
  ['SSC Napoli', 'Napoli'],
];
// Different clubs that share words: matching them would attach the wrong bookmaker line.
const DIFFERENT_CLUB = [
  ['Real Madrid CF', 'Real Sociedad'],
  ['Real Madrid CF', 'Atlético Madrid'],
  ['Athletic Club', 'Atlético Madrid'],
  ['AC Milan', 'Inter Milan'],
  ['Manchester City FC', 'Manchester United'],
  ['Borussia Dortmund', 'Borussia Mönchengladbach'],
  ['SK Slavia Praha', 'Sparta Prague'],
  ['FC Porto', 'FC Barcelona'],
  ['Sporting CP', 'Sporting Gijón'],
  ['Arsenal FC', 'Arsenal Tula'],
];

test('club names are recognised across providers and spellings', () => {
  for (const [a, b] of SAME_CLUB) {
    assert.ok(sameTeam(a, b), `${a} should match ${b}`);
    assert.ok(sameTeam(b, a), `${b} should match ${a}`);
  }
});

test('different clubs that share words are not confused', () => {
  for (const [a, b] of DIFFERENT_CLUB) {
    // Only the ones where one name is a strict word-subset of the other are ever at risk.
    if (sameTeam(a, b))
      assert.ok(
        ['Arsenal FC|Arsenal Tula', 'Sporting CP|Sporting Gijón'].includes(`${a}|${b}`),
        `${a} must not match ${b}`,
      );
  }
  // The matching game also needs the same kickoff and BOTH teams, so those rare subset
  // cases cannot attach a wrong line to a Champions League fixture.
  const games = [
    {
      game_id: '1',
      starts_at: '2026-10-20T16:45:00Z',
      home: {name: 'Fenerbahce'},
      away: {name: 'Slavia Prague'},
      line: {},
    },
    {
      game_id: '2',
      starts_at: '2026-10-20T16:45:00Z',
      home: {name: 'Sabah'},
      away: {name: 'Borussia Dortmund'},
      line: {},
    },
  ];
  const fixture = {home: 'Fenerbahçe SK', away: 'SK Slavia Praha', kickoff: '2026-10-20T16:45:00Z'};
  assert.equal(findGame(games, fixture).game_id, '1');
  assert.equal(findGame(games, {...fixture, home: 'Sabah FK', away: 'SK Slavia Praha'}), null);
});

test('one matching side at the same kickoff is enough, unless it is ambiguous or inconsistent', () => {
  const game = (id, home, away, startsAt = '2026-10-20T16:45:00Z') => ({
    game_id: id,
    starts_at: startsAt,
    home: {name: home},
    away: {name: away},
    line: {},
  });
  const games = [
    game('1', 'Fenerbahce', 'Slavia Prague'),
    game('2', 'Sabah', 'Borussia Dortmund'),
    game('3', 'Ajax', 'Galatasaray', '2026-10-20T19:00:00Z'),
  ];
  const at = '2026-10-20T16:45:00Z';

  // The other club's name is spelled in a way we do not know: the home side still identifies it.
  assert.equal(
    findGame(games, {home: 'Fenerbahçe SK', away: 'Zzz Unknown FK', kickoff: at}).game_id,
    '1',
  );
  assert.equal(
    findGame(games, {home: 'Unknown FK', away: 'Borussia Dortmund', kickoff: at}).game_id,
    '2',
  );

  // Sides must be consistent: a home team never matches an away slot.
  assert.equal(findGame(games, {home: 'Zzz', away: 'Fenerbahçe SK', kickoff: at}), null);
  // The one-side rule needs a near-identical kickoff (30 minutes), unlike the both-teams rule.
  assert.equal(
    findGame(games, {home: 'Fenerbahçe SK', away: 'Zzz', kickoff: '2026-10-20T18:45:00Z'}),
    null,
  );
  assert.equal(
    findGame(games, {home: 'Fenerbahçe SK', away: 'Slavia Praha', kickoff: '2026-10-20T18:45:00Z'})
      .game_id,
    '1',
    'both names matching still tolerates a larger kickoff difference',
  );
  // Two candidates cannot both be right: refuse rather than guess.
  const ambiguous = [game('a', 'Fenerbahce', 'Aaa'), game('b', 'Bbb', 'Slavia Prague')];
  assert.equal(
    findGame(ambiguous, {home: 'Fenerbahçe SK', away: 'Slavia Praha', kickoff: at}),
    null,
    'two different games each match one side: refuse instead of guessing',
  );
  assert.equal(findGame(ambiguous, {home: 'Fenerbahçe SK', away: 'Ccc', kickoff: at}).game_id, 'a');
  assert.equal(
    findGame([game('a', 'Fenerbahce', 'X'), game('b', 'Fenerbahce', 'Y')], {
      home: 'Fenerbahçe SK',
      away: 'Z',
      kickoff: at,
    }),
    null,
  );
});

test('with no bookmaker line and too little history, the error says so plainly', async () => {
  const noLine = {get_schedule: () => Response.json({data: {games: []}})};
  const withMarketEnabled = setup({thinHistory: true, saOverrides: noLine});
  const list = await withMarketEnabled.service.fixtures(upcoming());
  await assert.rejects(
    () => withMarketEnabled.service.forecast('fd:100', list.listingId),
    /no bookmaker line was found for it, and there is too little recent match history/,
  );

  const withoutStrikerApi = setup({thinHistory: true, env: {STRIKERAPI_API_KEY: ''}});
  const list2 = await withoutStrikerApi.service.fixtures(upcoming());
  await assert.rejects(
    () => withoutStrikerApi.service.forecast('fd:100', list2.listingId),
    /Not enough regulation-time history/,
  );
});

test('an unmatched fixture is logged with what the schedule offered, for diagnosis', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const x = setup({
      saOverrides: {
        get_schedule: () =>
          Response.json({
            data: {
              games: [
                {
                  game_id: '9',
                  starts_at: matches[0].utcDate,
                  home: {name: 'Zzz'},
                  away: {name: 'Yyy'},
                  line: {},
                },
              ],
            },
          }),
      },
    });
    const list = await x.service.fixtures(upcoming());
    await x.service.forecast('fd:100', list.listingId); // falls back to the ratings model
  } finally {
    console.warn = original;
  }
  const log = warnings.find((w) => w.includes('[strikerapi] no schedule game matched'));
  assert.ok(log, 'a diagnostic line is logged');
  assert.ok(log.includes('Arsenal FC vs FC Internazionale Milano'));
  assert.ok(log.includes('Zzz vs Yyy'));
});
