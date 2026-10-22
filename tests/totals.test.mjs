import test from 'node:test';
import assert from 'node:assert/strict';
import {goalsFromTotalLine, settleSelection, settle} from '../server/model.mjs';
import {fairOdds} from '../server/analysis.mjs';
import {marketsFromMatrix, ratingsForecast} from '../server/ratings.mjs';
import {
  pickFollowsForecast,
  pickKind,
  pickLabel,
  pickProbability,
  summarizePicks,
} from '../server/pickstats.mjs';
import {buildSnapshot} from '../server/service/shares.mjs';
import {buildPayload} from '../server/service/reminders.mjs';
import {createService, hash} from '../server/service.mjs';
import {makeHandler} from '../server/handler.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {
  createFakeSupabase,
  PUBLISHABLE_KEY,
  SERVICE_KEY,
  SUPABASE_URL,
} from './helpers/fake-supabase.mjs';

const finished = (home, away, status = 'FT') => ({
  fixture: {status: {short: status}},
  score: {fulltime: {home, away}},
});

// ---------- settlement ----------

test('Over/Under picks settle from the regulation-time total', () => {
  const over = {market: 'totals', line: 2.5, outcome: 0};
  const under = {market: 'totals', line: 2.5, outcome: 1};
  assert.equal(settleSelection(finished(2, 1), over).result, 'correct');
  assert.equal(settleSelection(finished(2, 1), under).result, 'incorrect');
  assert.equal(settleSelection(finished(1, 1), over).result, 'incorrect');
  assert.equal(settleSelection(finished(1, 1), under).result, 'correct');
  assert.equal(settleSelection(finished(2, 1), over).score, '2–1');
  assert.equal(
    settleSelection(finished(0, 0), {market: 'totals', line: 0.5, outcome: 1}).result,
    'correct',
  );
  assert.equal(settleSelection(finished(1, 1, '2H'), over), null, 'not finished yet');
  assert.deepEqual(settleSelection(finished(0, 0, 'CANC'), over), {result: 'void', score: null});
});

test('home/draw/away settlement is unchanged', () => {
  assert.equal(settle(finished(2, 1), 0).result, 'correct');
  assert.equal(settle(finished(1, 1), 1).result, 'correct');
  assert.equal(settle(finished(0, 3), 2).result, 'correct');
  assert.equal(settle(finished(0, 3), 0).result, 'incorrect');
  assert.equal(
    settleSelection(finished(2, 1), {outcome: 0}).result,
    'correct',
    'result is the default market',
  );
});

// ---------- probabilities in betting format ----------

test('fair odds are 1 ÷ probability, with no margin', () => {
  assert.equal(fairOdds(50), 2);
  assert.equal(fairOdds(40), 2.5);
  assert.equal(fairOdds(62), 1.61);
  assert.equal(fairOdds(0), null);
  assert.equal(fairOdds(NaN), null);
});

test('a bookmakers’ total line gives even money at that line and sensible lines around it', () => {
  const g = goalsFromTotalLine(2.5);
  const at25 = g.lines.find((l) => l.line === 2.5);
  assert.ok(Math.abs(at25.over - 50) < 0.2, `over 2.5 should be about 50%, got ${at25.over}`);
  assert.ok(g.expectedTotal > 2.5 && g.expectedTotal < 2.9, String(g.expectedTotal));
  const overs = g.lines.map((l) => l.over);
  for (let i = 1; i < overs.length; i++) assert.ok(overs[i] < overs[i - 1]);
  for (const l of g.lines) assert.ok(Math.abs(l.over + l.under - 100) < 0.11);
  assert.equal(g.btts, null, 'a total says nothing about who scores');

  // A whole-number line can push, so even money means P(over) = P(under), both below 50%.
  const whole = goalsFromTotalLine(3);
  assert.ok(whole.expectedTotal > g.expectedTotal);
  const high = goalsFromTotalLine(3.5).lines.find((l) => l.line === 2.5);
  assert.ok(high.over > 60, 'a high total line makes over 2.5 likely');

  assert.equal(goalsFromTotalLine(null), null);
  assert.equal(goalsFromTotalLine(0), null);
  assert.equal(goalsFromTotalLine('x'), null);
});

test('the ratings model exposes Over/Under from its scoreline matrix, consistent with 1X2', () => {
  const m = [
    [0.1, 0.1, 0.05],
    [0.15, 0.2, 0.08],
    [0.12, 0.1, 0.1],
  ];
  const r = marketsFromMatrix(m);
  assert.equal(
    r.p.reduce((s, v) => s + v, 0),
    100,
  );
  assert.deepEqual(
    r.goals.lines.map((l) => l.line),
    [0.5, 1.5, 2.5, 3.5],
  );
  // Over 2.5 = scores with 3 or more goals: (1,2) (2,1) (2,2) = 0.08+0.1+0.1 of a total 1.0
  assert.equal(r.goals.lines[2].over, 28);
  assert.equal(r.goals.btts, Math.round((0.2 + 0.08 + 0.1 + 0.1) * 1000) / 10);
});

// ---------- pick helpers shared with the browser ----------

const forecastWithGoals = {
  home: 'Arsenal',
  away: 'Chelsea',
  p: [48, 27, 25],
  goals: {lines: [{line: 2.5, over: 58, under: 42}], btts: 55},
};

test('labels, probabilities and “followed the forecast” work for both markets', () => {
  const over = {market: 'totals', line: 2.5, outcome: 0, forecast: forecastWithGoals};
  const under = {market: 'totals', line: 2.5, outcome: 1, forecast: forecastWithGoals};
  const home = {outcome: 0, forecast: forecastWithGoals};
  const draw = {outcome: 1, forecast: forecastWithGoals};
  assert.equal(pickLabel(over), 'Over 2.5 goals');
  assert.equal(pickLabel(under), 'Under 2.5 goals');
  assert.equal(pickLabel(home), 'Arsenal win');
  assert.equal(pickLabel(draw), 'Draw');
  assert.equal(pickProbability(over), 58);
  assert.equal(pickProbability(under), 42);
  assert.equal(pickProbability(home), 48);
  assert.equal(pickFollowsForecast(over), true);
  assert.equal(pickFollowsForecast(under), false);
  assert.equal(pickFollowsForecast(home), true);
  assert.equal(pickFollowsForecast(draw), false);
  assert.equal(pickKind(over), 'Over 2.5');
  assert.equal(pickKind(home), 'Home win');
  // A totals pick whose forecast had no goals estimate is simply unknown, never a crash.
  const bare = {
    market: 'totals',
    line: 2.5,
    outcome: 0,
    forecast: {home: 'A', away: 'B', p: [50, 25, 25]},
  };
  assert.ok(Number.isNaN(pickProbability(bare)));
  assert.equal(pickFollowsForecast(bare), null);
});

test('statistics group Over/Under picks on their own rows and count them in accuracy', () => {
  const pick = (market, outcome, result) => ({
    id: hash(market + outcome + result + Math.random()),
    ...(market === 'totals' ? {market, line: 2.5} : {}),
    outcome,
    result,
    createdAt: 0,
    forecast: {...forecastWithGoals, kickoff: '2026-10-01T19:00:00Z'},
  });
  const s = summarizePicks([
    pick('result', 0, 'correct'),
    pick('totals', 0, 'correct'),
    pick('totals', 0, 'incorrect'),
    pick('totals', 1, 'correct'),
  ]);
  assert.equal(s.settled, 4);
  assert.equal(s.correct, 3);
  const row = (label) => s.byOutcome.find((o) => o.label === label);
  assert.deepEqual([row('Over 2.5').settled, row('Over 2.5').correct], [2, 1]);
  assert.deepEqual([row('Under 2.5').settled, row('Under 2.5').correct], [1, 1]);
  assert.equal(row('Home win').settled, 1);
  assert.equal(s.followedModel.following.settled, 3, 'home win and both overs follow the forecast');
  assert.equal(s.followedModel.against.settled, 1);
});

test('share snapshots and reminders describe Over/Under picks in words', () => {
  const pick = {
    id: 'x',
    market: 'totals',
    line: 2.5,
    outcome: 1,
    result: 'correct',
    score: '1–0',
    createdAt: 0,
    forecast: {...forecastWithGoals, competition: 'League', kickoff: '2026-10-01T19:00:00Z'},
  };
  const snapshot = buildSnapshot([pick], Date.now());
  assert.equal(snapshot.picks[0].pick, 'Under 2.5 goals');
  assert.equal(snapshot.picks[0].probability, 42);
  const payload = buildPayload([{pick, kickoff: Date.now() + 30 * 60_000}], Date.now());
  assert.match(payload.body, /Your pick: Under 2\.5 goals\./);
});

// ---------- through the service: forecast, pick, settle ----------

const base = Date.parse('2026-10-14T10:00:00Z');
const kickoff = '2026-10-14T20:00:00Z';

/** An API-Football + StrikerAPI world where the schedule carries a total line. */
function setup({total = 2.75, strikerApi = true, accounts = false, env = {}} = {}) {
  let clock = base;
  let finishedScore = null;
  const db = createFakeSupabase();
  const apRaw = (id = 100) => ({
    fixture: {id, date: kickoff, status: {short: finishedScore ? 'FT' : 'NS'}},
    league: {id: 39, name: 'Premier League', season: 2026},
    teams: {home: {name: 'Arsenal'}, away: {name: 'Chelsea'}},
    goals: {home: finishedScore?.[0] ?? null, away: finishedScore?.[1] ?? null},
    score: {fulltime: {home: finishedScore?.[0] ?? null, away: finishedScore?.[1] ?? null}},
  });
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
            : u.searchParams.has('id')
              ? [apRaw(Number(u.searchParams.get('id')))]
              : [apRaw()];
      return Response.json({response, errors: [], paging: {total: 1}});
    }
    if (u.hostname.includes('strikerapi')) {
      if (u.pathname.includes('schedule'))
        return Response.json({
          data: {
            games: [
              {
                game_id: 'g1',
                starts_at: kickoff,
                home: {name: 'Arsenal'},
                away: {name: 'Chelsea'},
                line: {home_ml: -110, draw_ml: +260, away_ml: +300, total, books: 8},
              },
            ],
          },
        });
      return Response.json({});
    }
    return db.fetcher(url, opts);
  };
  const service = createService({
    env: {
      API_FOOTBALL_KEY: 'ap-test',
      ...env,
      ...(strikerApi ? {STRIKERAPI_API_KEY: 'sa-test'} : {}),
      ...(accounts
        ? {
            SUPABASE_URL,
            SUPABASE_SECRET_KEY: SERVICE_KEY,
            SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
          }
        : {}),
    },
    store: createMemoryStore(),
    fetcher,
    now: () => clock,
  });
  return {
    service,
    db,
    finish: (h, a) => (finishedScore = [h, a]),
    setTime: (t) => (clock = t),
  };
}

async function openForecast(x) {
  const list = await x.service.fixtures(new URLSearchParams({from: '2026-10-14', league: 'ap:39'}));
  return x.service.forecast('ap:100', list.listingId);
}

test('with a bookmaker line the market leads the forecast and its total line gives the Over/Under', async () => {
  const x = setup({total: 2.75});
  const f = await openForecast(x);
  assert.equal(f.source, 'StrikerAPI · market consensus');
  assert.equal(f.goalsSource, 'market-total');
  assert.equal(f.marketTotal, 2.75);
  const line = f.goals.lines.find((l) => l.line === 2.5);
  assert.ok(line.over > 50 && line.over < 65, `over 2.5 ${line.over}% for a 2.75 total`);
  assert.equal(f.analysis.goals.lines[2].over, line.over, 'the analysis carries the same goals');
});

test('FORECAST_PRIMARY=api-football restores the old order; the total line still feeds the goals', async () => {
  const x = setup({total: 2.75, env: {FORECAST_PRIMARY: 'api-football'}});
  const f = await openForecast(x);
  assert.equal(f.source, 'API-Football');
  assert.deepEqual(f.p, [55, 25, 20]);
  assert.equal(f.goalsSource, 'market-total');
});
test('an Over 2.5 pick is saved, listed with its words, and settled from the score', async () => {
  const x = setup({total: 2.75});
  const f = await openForecast(x);
  const sid = 'browser-a';
  assert.deepEqual(await x.service.save(sid, f.forecastId, 0, 'totals', 2.5), {saved: true});
  assert.deepEqual(
    await x.service.save(sid, f.forecastId, 0, 'totals', 2.5),
    {saved: false},
    'one per market',
  );
  assert.deepEqual(
    await x.service.save(sid, f.forecastId, 0),
    {saved: true},
    'a result pick on the same match is separate',
  );
  const picks = await x.service.picks(sid);
  assert.equal(picks.length, 2);
  const over = picks.find((p) => p.market === 'totals');
  assert.equal(over.line, 2.5);
  assert.equal(pickLabel(over), 'Over 2.5 goals');
  assert.ok(pickProbability(over) > 50);

  x.setTime(Date.parse('2026-10-15T01:00:00Z'));
  x.finish(2, 2);
  const settled = await x.service.settlePicks(sid);
  assert.equal(settled.settled, 2);
  const after = await x.service.picks(sid);
  assert.equal(after.find((p) => p.market === 'totals').result, 'correct', '4 goals is over 2.5');
  assert.equal(after.find((p) => !p.market).result, 'incorrect', '2-2 is not a home win');
});

test('invalid Over/Under picks are refused', async () => {
  const x = setup({total: 2.75});
  const f = await openForecast(x);
  await assert.rejects(() => x.service.save('b', f.forecastId, 2, 'totals', 2.5), /Invalid pick/);
  await assert.rejects(() => x.service.save('b', f.forecastId, 0, 'totals', 2.75), /Invalid pick/);
  await assert.rejects(() => x.service.save('b', f.forecastId, 0, 'spread', 2.5), /Unknown market/);
});

test('without any goal estimate an Over/Under pick is refused, with a reason', async () => {
  const x = setup({strikerApi: false}); // API-Football only: no total line, no history
  const f = await openForecast(x);
  assert.equal(f.goals, null);
  await assert.rejects(
    () => x.service.save('c', f.forecastId, 0, 'totals', 2.5),
    /no Over\/Under estimate/,
  );
});

test('HTTP: the save action accepts market and line', async () => {
  const x = setup({total: 2.75});
  const f = await openForecast(x);
  const handler = makeHandler(() => x.service, {});
  const response = await handler(
    new Request('https://app.example/api/football', {
      method: 'POST',
      headers: {'content-type': 'application/json', origin: 'https://app.example'},
      body: JSON.stringify({
        action: 'save',
        forecastId: f.forecastId,
        market: 'totals',
        line: 2.5,
        outcome: 1,
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {saved: true});
});

test('accounts: an Over/Under pick is stored with its market, and an old schema says what to run', async () => {
  const x = setup({total: 2.75, accounts: true});
  const f = await openForecast(x);
  const sid = 'acct:11111111-1111-4111-8111-111111111111';
  await x.db.tables.profiles.push({id: '11111111-1111-4111-8111-111111111111'});
  assert.deepEqual(await x.service.save(sid, f.forecastId, 1, 'totals', 2.5), {saved: true});
  const row = x.db.tables.picks[0];
  assert.equal(row.market, 'totals');
  assert.equal(row.line, 2.5);
  const listed = await x.service.picks(sid);
  assert.equal(listed[0].market, 'totals');
  assert.equal(listed[0].line, 2.5);

  const old = setup({total: 2.75, accounts: true});
  old.db.dropColumn('picks', 'market');
  const g = await openForecast(old);
  await assert.rejects(
    () => old.service.save(sid, g.forecastId, 0, 'totals', 2.5),
    /run supabase\/schema\.sql again/,
  );
  assert.deepEqual(
    await old.service.save(sid, g.forecastId, 0),
    {saved: true},
    'result picks still work on the old schema',
  );
  const check = (await old.service.diagnostics.run()).items.find((i) => i.id === 'supabase-schema');
  assert.equal(check.state, 'error');
});
