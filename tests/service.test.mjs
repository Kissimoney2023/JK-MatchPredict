import test from 'node:test';
import assert from 'node:assert/strict';
import {createService, dates} from '../server/service.mjs';
import {analyze} from '../server/analysis.mjs';
import {makeHandler} from '../server/handler.mjs';
import {goalModel, fdSettlementRaw, settle} from '../server/model.mjs';
class Store {
  data = new Map();
  seq = 0;
  async get(k) {
    return structuredClone(this.data.get(k)?.data ?? null);
  }
  async getWithMetadata(k) {
    return structuredClone(this.data.get(k) ?? null);
  }
  async setJSON(k, data, opts = {}) {
    const old = this.data.get(k);
    if ((opts.onlyIfNew && old) || (opts.onlyIfMatch && old?.etag !== opts.onlyIfMatch))
      return {modified: false};
    this.data.set(k, {data: structuredClone(data), etag: String(++this.seq)});
    return {modified: true};
  }
}
const base = Date.parse('2026-10-14T10:00:00Z'),
  kickoff = '2026-10-14T20:00:00Z';
function setup({primary = true, fallback = true, fail = false, missing = false} = {}) {
  const store = new Store();
  let clock = base,
    calls = [];
  const env = {
    API_FOOTBALL_KEY: primary ? 'ap-test' : '',
    FOOTBALL_DATA_ORG_KEY: fallback ? 'fd-test' : '',
  };
  let finish = false;
  const apRaw = (id = 100, league = 39) => ({
    fixture: {id, date: kickoff, status: {short: finish ? 'FT' : 'NS'}},
    league: {id: league, name: league === 39 ? 'Premier League' : 'La Liga', season: 2026},
    teams: {home: {name: 'Arsenal'}, away: {name: 'Chelsea'}},
    goals: {home: finish ? 2 : null, away: finish ? 1 : null},
    score: {fulltime: {home: finish ? 2 : null, away: finish ? 1 : null}},
  });
  const fdRaw = {
    id: 200,
    competition: {code: 'PL', name: 'Premier League'},
    utcDate: kickoff,
    status: 'TIMED',
    stage: 'REGULAR_SEASON',
    season: {startDate: '2026-08-01'},
    homeTeam: {id: 11, name: 'Arsenal FC'},
    awayTeam: {id: 22, name: 'Chelsea FC'},
  };
  const history = Array.from({length: 8}, (_, i) => ({
    id: 300 + i,
    utcDate: new Date(base - (i + 1) * 86400000).toISOString(),
    status: 'FINISHED',
    homeTeam: {id: 11},
    awayTeam: {id: 22},
    score: {duration: 'REGULAR', fullTime: {home: 2, away: 1}},
  }));
  const fetcher = async (url, opts) => {
    const u = new URL(url);
    calls.push(url);
    if (u.hostname.includes('api-sports')) {
      assert.equal(opts.headers['x-apisports-key'], 'ap-test');
      if (fail) return Response.json({}, {status: 429});
      const response =
        u.pathname === '/leagues'
          ? [39, 140].map((id) => ({
              league: {id, name: id === 39 ? 'Premier League' : 'La Liga', type: 'League'},
              country: {name: id === 39 ? 'England' : 'Spain'},
              seasons: [{current: true, year: 2026, coverage: {predictions: true}}],
            }))
          : u.pathname === '/predictions'
            ? missing
              ? []
              : [{predictions: {percent: {home: '55%', draw: '25%', away: '20%'}}}]
            : u.searchParams.has('id')
              ? [apRaw(Number(u.searchParams.get('id')))]
              : [apRaw()];
      return Response.json({response, errors: [], paging: {total: 1}});
    }
    assert.equal(opts.headers['X-Auth-Token'], 'fd-test');
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
    if (u.pathname.includes('/teams/')) return Response.json({matches: history});
    if (u.pathname === '/v4/matches/200') return Response.json(fdRaw);
    return Response.json({matches: [fdRaw]});
  };
  return {
    store,
    service: createService({env, store, fetcher, now: () => clock}),
    calls,
    setTime: (t) => (clock = t),
    finish: () => (finish = true),
  };
}
test('catalog merges provider mappings; leagues, dates and cached fixtures', async () => {
  const {service, calls} = setup();
  const c = await service.catalog();
  assert.equal(c.leagues.length, 2);
  assert(c.leagues.find((x) => x.apId === 39).fallback);
  const params = new URLSearchParams({from: '2026-10-14', to: '2026-10-14', league: 'ap:39'});
  const list = await service.fixtures(params);
  assert.equal(list.fixtures[0].competition, 'Premier League');
  assert.equal(list.fixtures[0].key, 'ap:100');
  const n = calls.length;
  await service.fixtures(params);
  assert.equal(calls.length, n);
  await assert.rejects(
    () =>
      service.fixtures(new URLSearchParams({from: '2026-10-14', to: '2026-10-16', league: 'all'})),
    /one date/,
  );
  assert.throws(() => dates(new URLSearchParams({from: '2026-02-30'})), /valid date/);
});
test('forecast, transparent tips, immutable picks and settlement', async () => {
  const x = setup();
  const l = await x.service.fixtures(new URLSearchParams({from: '2026-10-14'})),
    f = await x.service.forecast('ap:100', l.listingId);
  assert.equal(f.analysis.predictedWinner, 'Arsenal');
  assert.equal(f.analysis.tips[1].probability, 80);
  assert.equal(f.analysis.tips.length, 2);
  assert.equal((await x.service.save('user-a', f.forecastId, 0)).saved, true);
  assert.equal((await x.service.save('user-a', f.forecastId, 2)).saved, false);
  assert.equal((await x.service.picks('user-b')).length, 0);
  assert.equal((await x.service.picks('user-a'))[0].outcome, 0);
  x.setTime(Date.parse('2026-10-15T01:00:00Z'));
  x.finish();
  assert.equal((await x.service.settlePicks('user-a')).settled, 1);
  assert.equal((await x.service.picks('user-a'))[0].result, 'correct');
  await assert.rejects(() => x.service.save('user-b', f.forecastId, 0), /expired|kickoff/);
});
test('API outage falls back, retains a stable source and model labels', async () => {
  const x = setup({fail: true});
  const l = await x.service.fixtures(new URLSearchParams({from: '2026-10-14'}));
  assert.equal(l.source, 'football-data.org');
  assert.equal(l.fixtures[0].key, 'fd:200');
  const f = await x.service.forecast('fd:200', l.listingId);
  assert.equal(f.modelVersion, 'jk-poisson-v1');
  assert.equal(f.analysis.tips.length, 4);
  assert(f.explanation.includes('Not calibrated'));
  assert.equal(
    f.p.reduce((a, b) => a + b),
    100,
  );
});
test('missing primary prediction uses verified fallback history', async () => {
  const x = setup({missing: true}),
    l = await x.service.fixtures(new URLSearchParams({from: '2026-10-14'})),
    f = await x.service.forecast('ap:100', l.listingId);
  assert(f.fallback);
  assert.equal(f.key, 'ap:100');
  assert(f.source.includes('football-data.org'));
});
test('forecast lookup requires a listed fixture and stops at kickoff', async () => {
  const x = setup(),
    l = await x.service.fixtures(new URLSearchParams({from: '2026-10-14'}));
  await assert.rejects(() => x.service.forecast('ap:999', l.listingId), /browser/);
  x.setTime(Date.parse(kickoff));
  await assert.rejects(() => x.service.forecast('ap:100', l.listingId), /closed/);
});
test('draw and close games are not presented as certain team wins', () => {
  const a = analyze({home: 'A', away: 'B', p: [33, 34, 33]});
  assert.equal(a.predictedOutcome, 'Draw');
  assert.equal(a.predictedWinner, 'No clear winning team');
  assert(a.verdict.includes('skipping'));
  const tie = analyze({home: 'A', away: 'B', p: [40, 20, 40]});
  assert.equal(tie.predictedOutcome, 'No clear favorite');
});
test('fallback never settles extra-time totals as regulation scores', () => {
  const raw = {
    id: 1,
    competition: {code: 'PL'},
    homeTeam: {name: 'A'},
    awayTeam: {name: 'B'},
    utcDate: kickoff,
    status: 'FINISHED',
    score: {duration: 'EXTRA_TIME', fullTime: {home: 3, away: 2}},
  };
  assert.equal(settle(fdSettlementRaw(raw), 0), null);
  assert.equal(goalModel([], [], 1, 2, kickoff), null);
});
test('HTTP session isolation, cookie flags, CSRF and secret-free status', async () => {
  const x = setup(),
    handler = makeHandler(() => x.service),
    origin = 'https://example.netlify.app';
  const r = await handler(new Request(origin + '/api/football?action=status'), {ip: 'test-ip'});
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie');
  assert(cookie.includes('HttpOnly'));
  assert(cookie.includes('Secure'));
  const text = await r.text();
  assert(!text.includes('ap-test'));
  assert(!text.includes('fd-test'));
  const denied = await handler(
    new Request(origin + '/api/football', {
      method: 'POST',
      headers: {origin: 'https://evil.test', 'content-type': 'application/json'},
      body: '{"action":"settle"}',
    }),
    {ip: 'test-ip'},
  );
  assert.equal(denied.status, 403);
  const empty = await handler(
    new Request(origin + '/api/football?action=picks', {headers: {cookie: cookie.split(';')[0]}}),
    {ip: 'test-ip'},
  );
  assert.deepEqual((await empty.json()).picks, []);
});
test('atomic quotas block calls after the configured budget', async () => {
  const x = setup();
  await x.service.budget('unit', 2, 60000);
  await x.service.budget('unit', 2, 60000);
  await assert.rejects(() => x.service.budget('unit', 2, 60000), /budget/);
});
