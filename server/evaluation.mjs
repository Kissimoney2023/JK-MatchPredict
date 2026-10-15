import {goalModel} from './model.mjs';
import {DEFAULTS, fitRatings, predictMatch} from './ratings.mjs';

const DAY = 86_400_000;
const EPS = 1e-6;

const outcomeOf = (r) => (r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2);

/** Log loss and (multi-class) Brier score of one probability triple (fractions) for an outcome. */
export function scoreOne(p, outcome) {
  const logLoss = -Math.log(Math.max(p[outcome], EPS));
  const brier = p.reduce((s, v, i) => s + (v - (i === outcome ? 1 : 0)) ** 2, 0);
  return {logLoss, brier, correct: p.indexOf(Math.max(...p)) === outcome ? 1 : 0};
}

/** Aggregates per-match predictions into summary metrics and a calibration table. */
export function summarize(predictions) {
  const n = predictions.length;
  if (!n) return {n: 0};
  let logLoss = 0;
  let brier = 0;
  let correct = 0;
  const bins = Array.from({length: 10}, () => ({sum: 0, hits: 0, n: 0}));
  for (const {p, outcome} of predictions) {
    const s = scoreOne(p, outcome);
    logLoss += s.logLoss;
    brier += s.brier;
    correct += s.correct;
    p.forEach((v, i) => {
      const bin = bins[Math.min(9, Math.floor(v * 10))];
      bin.sum += v;
      bin.n++;
      if (i === outcome) bin.hits++;
    });
  }
  return {
    n,
    accuracy: correct / n,
    logLoss: logLoss / n,
    brier: brier / n,
    calibration: bins
      .map((b, i) => ({
        range: `${i * 10}-${i * 10 + 10}%`,
        predicted: b.n ? b.sum / b.n : null,
        observed: b.n ? b.hits / b.n : null,
        n: b.n,
      }))
      .filter((b) => b.n),
  };
}

const toFractions = (percent) => percent.map((v) => v / 100);

/** Result objects -> raw-looking football-data rows, so the legacy model can be compared. */
const asRows = (results) =>
  results.map((r, i) => ({
    id: i,
    utcDate: new Date(r.t).toISOString(),
    status: 'FINISHED',
    homeTeam: {id: r.home},
    awayTeam: {id: r.away},
    score: {duration: 'REGULAR', fullTime: {home: r.hg, away: r.ag}},
  }));

/**
 * Rolling-origin backtest. For each test match, models are fitted using only results played
 * before the start of its refit window. Compares the ratings model with
 *  - "prior": the training set's home/draw/away frequencies
 *  - "legacy": the original goal-average model (jk-poisson-v1)
 * All three are scored on the same matches (those every model can predict).
 */
export function backtest(
  results,
  {
    testDays = 90,
    refitDays = 7,
    testFrom,
    testTo,
    trainDays = 365,
    keepPredictions = false,
    options = {},
  } = {},
) {
  const opts = {...DEFAULTS, ...options};
  const sorted = [...results].sort((a, b) => a.t - b.t);
  if (!sorted.length) return {matches: 0, skipped: 0, models: {}};
  const end = testTo ?? sorted[sorted.length - 1].t;
  const start = testFrom ?? end - testDays * DAY;
  // When results carry a bookmaker line (`market`: three fractions), it is scored too, on the
  // same matches, and matches without one are skipped for every model.
  const withMarket = sorted.some((r) => r.market);
  const predictions = {ratings: [], prior: [], legacy: [], ...(withMarket ? {market: []} : {})};
  let skipped = 0;

  for (let windowStart = start; windowStart <= end; windowStart += refitDays * DAY) {
    const windowEnd = windowStart + refitDays * DAY;
    // Like production, a model only sees roughly the last year of results.
    const train = sorted.filter((r) => r.t < windowStart && r.t >= windowStart - trainDays * DAY);
    const test = sorted.filter((r) => r.t >= windowStart && r.t < windowEnd && r.t <= end);
    if (!test.length || train.length < 20) {
      skipped += test.length;
      continue;
    }
    const ratings = fitRatings(train, windowStart, opts);
    const counts = [0, 0, 0];
    for (const r of train) counts[outcomeOf(r)]++;
    const prior = counts.map((c) => c / train.length);
    const rows = asRows(train);

    for (const r of test) {
      if (withMarket && !r.market) {
        skipped++;
        continue;
      }
      const played = (id) => ratings.count[ratings.index.get(id)] ?? 0;
      if (played(r.home) < opts.minMatchesPerTeam || played(r.away) < opts.minMatchesPerTeam) {
        skipped++;
        continue;
      }
      const modelPrediction = predictMatch(ratings, r.home, r.away, opts);
      const legacy = goalModel(rows, rows, r.home, r.away, new Date(r.t).toISOString(), r.t);
      if (!modelPrediction || !legacy) {
        skipped++;
        continue;
      }
      const outcome = outcomeOf(r);
      predictions.ratings.push({p: toFractions(modelPrediction.p), outcome});
      predictions.legacy.push({p: toFractions(legacy.p), outcome});
      predictions.prior.push({p: prior, outcome});
      if (withMarket) predictions.market.push({p: r.market, outcome});
    }
  }

  return {
    matches: predictions.ratings.length,
    skipped,
    ...(keepPredictions ? {predictions} : {}),
    models: Object.fromEntries(Object.entries(predictions).map(([k, v]) => [k, summarize(v)])),
  };
}
