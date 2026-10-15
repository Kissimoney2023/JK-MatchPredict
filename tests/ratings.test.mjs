import test from 'node:test';
import assert from 'node:assert/strict';
import {collectResults, fitRatings, predictMatch, ratingsForecast} from '../server/ratings.mjs';
import {backtest, scoreOne, summarize} from '../server/evaluation.mjs';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-14T00:00:00Z');

/** Small deterministic RNG so the synthetic league is reproducible. */
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(lambda, random) {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= random();
  } while (p > limit);
  return k - 1;
}
const normal = (random) =>
  Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());

/** A league with known team strengths: 16 teams, three double round-robins over ~1 year. */
function syntheticLeague({teams = 16, rounds = 3, seed = 7} = {}) {
  const random = rng(seed);
  const truth = Array.from({length: teams}, () => ({
    attack: 0.35 * normal(random),
    defence: 0.35 * normal(random),
  }));
  const mu = 0.15;
  const homeAdvantage = 0.25;
  const results = [];
  const total = teams * (teams - 1) * rounds;
  let n = 0;
  for (let r = 0; r < rounds; r++)
    for (let h = 0; h < teams; h++)
      for (let a = 0; a < teams; a++) {
        if (h === a) continue;
        const t = NOW - 365 * DAY + (n++ / total) * 360 * DAY;
        const lh = Math.exp(mu + homeAdvantage + truth[h].attack - truth[a].defence);
        const la = Math.exp(mu + truth[a].attack - truth[h].defence);
        results.push({
          t,
          home: h + 1,
          away: a + 1,
          hg: poisson(lh, random),
          ag: poisson(la, random),
        });
      }
  return {results, truth, homeAdvantage};
}

const correlation = (x, y) => {
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  x.forEach((v, i) => {
    sxy += (v - mx) * (y[i] - my);
    sxx += (v - mx) ** 2;
    syy += (y[i] - my) ** 2;
  });
  return sxy / Math.sqrt(sxx * syy);
};

test('fitRatings recovers known attack/defence strengths and home advantage', () => {
  const {results, truth, homeAdvantage} = syntheticLeague();
  const fit = fitRatings(results, NOW, {halfLifeDays: 10_000}); // no recency decay here
  const ids = truth.map((_, i) => i + 1);
  const attack = ids.map((id) => fit.attack[fit.index.get(id)]);
  const defence = ids.map((id) => fit.defence[fit.index.get(id)]);
  assert.ok(
    correlation(
      attack,
      truth.map((t) => t.attack),
    ) > 0.9,
  );
  assert.ok(
    correlation(
      defence,
      truth.map((t) => t.defence),
    ) > 0.9,
  );
  assert.ok(Math.abs(fit.home - homeAdvantage) < 0.1, `home advantage ${fit.home}`);
});

test('predictMatch: probabilities sum to 100 and strong beats weak', () => {
  const {results, truth} = syntheticLeague();
  const fit = fitRatings(results, NOW);
  const score = (i) => truth[i].attack + truth[i].defence;
  const order = truth.map((_, i) => i).sort((a, b) => score(b) - score(a));
  const best = order[0] + 1;
  const worst = order[order.length - 1] + 1;

  const home = predictMatch(fit, best, worst);
  const away = predictMatch(fit, worst, best);
  assert.equal(Math.round((home.p[0] + home.p[1] + home.p[2]) * 10) / 10, 100);
  assert.ok(home.p[0] > home.p[2]);
  assert.ok(away.p[2] > away.p[0]);
  assert.equal(predictMatch(fit, best, 9999), null, 'unknown teams are not predicted');
});

test('backtest: the ratings model beats the frequency prior and the legacy model', () => {
  const {results} = syntheticLeague({rounds: 4});
  const report = backtest(results, {testDays: 120, refitDays: 14});
  assert.ok(report.matches > 100, `only ${report.matches} matches evaluated`);
  const {ratings, prior, legacy} = report.models;
  assert.ok(ratings.logLoss < prior.logLoss, `${ratings.logLoss} vs prior ${prior.logLoss}`);
  assert.ok(ratings.logLoss < legacy.logLoss, `${ratings.logLoss} vs legacy ${legacy.logLoss}`);
  assert.ok(ratings.brier < prior.brier);
  assert.ok(ratings.calibration.length > 0);
});

test('scoring helpers behave on simple cases', () => {
  assert.ok(scoreOne([1, 0, 0], 0).logLoss < 1e-5);
  assert.equal(scoreOne([0.2, 0.5, 0.3], 1).correct, 1);
  assert.equal(scoreOne([0.5, 0.3, 0.2], 2).brier.toFixed(2), '0.98');
  assert.deepEqual(summarize([]), {n: 0});
});

test('collectResults drops extra-time, unfinished, duplicate and future matches', () => {
  const finished = (id, extra = {}) => ({
    id,
    utcDate: '2026-09-01T18:00:00Z',
    status: 'FINISHED',
    homeTeam: {id: 1},
    awayTeam: {id: 2},
    score: {duration: 'REGULAR', fullTime: {home: 1, away: 0}},
    ...extra,
  });
  const rows = [
    finished(1),
    finished(1), // duplicate
    finished(2, {score: {duration: 'EXTRA_TIME', fullTime: {home: 2, away: 2}}}),
    finished(3, {status: 'TIMED'}),
    finished(4, {utcDate: '2027-01-01T00:00:00Z'}),
  ];
  assert.equal(collectResults(rows, NOW).length, 1);
});

test('ratingsForecast needs enough matches per team, otherwise defers (null)', () => {
  const {results} = syntheticLeague({teams: 4, rounds: 1});
  const rows = results.map((r, i) => ({
    id: i,
    utcDate: new Date(r.t).toISOString(),
    status: 'FINISHED',
    homeTeam: {id: r.home},
    awayTeam: {id: r.away},
    score: {duration: 'REGULAR', fullTime: {home: r.hg, away: r.ag}},
  }));
  const kickoff = new Date(NOW + DAY).toISOString();
  // 4 teams, one round: each team has 6 matches, below the minimum of 8.
  assert.equal(ratingsForecast({rows, homeId: 1, awayId: 2, kickoff, now: NOW}), null);

  const big = syntheticLeague({teams: 8, rounds: 1});
  const bigRows = big.results.map((r, i) => ({
    id: i,
    utcDate: new Date(r.t).toISOString(),
    status: 'FINISHED',
    homeTeam: {id: r.home},
    awayTeam: {id: r.away},
    score: {duration: 'REGULAR', fullTime: {home: r.hg, away: r.ag}},
  }));
  const f = ratingsForecast({
    rows: bigRows,
    homeId: 1,
    awayId: 2,
    kickoff,
    now: NOW,
    options: {minMatchesPerTeam: 8},
  });
  assert.equal(f.modelVersion, 'jk-ratings-v2');
  assert.equal(
    f.p.reduce((a, b) => a + b),
    100,
  );
  assert.equal(f.expectedGoals.length, 2);
});

test('xgWeight: 0 ignores expected-goals estimates, 1 fits them instead of goals', () => {
  // Two teams that never score, but whose shots suggest 1.5 expected goals each.
  const results = Array.from({length: 30}, (_, i) => ({
    t: NOW - (i + 1) * DAY,
    home: i % 2 ? 1 : 2,
    away: i % 2 ? 2 : 1,
    hg: 0,
    ag: 0,
    hx: 1.5,
    ax: 1.5,
  }));
  const total = (options) => {
    const prediction = predictMatch(fitRatings(results, NOW, options), 1, 2);
    return prediction.expectedGoals[0] + prediction.expectedGoals[1];
  };
  assert.ok(total({xgWeight: 0}) < 0.8, 'goals only: very few goals expected');
  assert.ok(total({xgWeight: 1}) > 2.4, 'expected-goals target: about three goals in total');
  assert.ok(
    total({xgWeight: 0.5}) > total({xgWeight: 0}) && total({xgWeight: 0.5}) < total({xgWeight: 1}),
  );
  // Production default is unchanged, and results without estimates are unaffected.
  assert.equal(total({}), total({xgWeight: 0}));
  const plain = results.map(({hx, ax, ...rest}) => rest);
  const a = predictMatch(fitRatings(plain, NOW, {xgWeight: 1}), 1, 2);
  const b = predictMatch(fitRatings(plain, NOW, {xgWeight: 0}), 1, 2);
  assert.deepEqual(a, b);
});
