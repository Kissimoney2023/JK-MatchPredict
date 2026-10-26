import {fdRegulation} from './model.mjs';
import {dixonColesTau, poissonRow, clampRho, scoreMarkets} from './scores.mjs';

export {dixonColesTau};

const DAY = 86_400_000;

export const DEFAULTS = {
  halfLifeDays: 180, // a result this old counts half as much as one from today
  ridge: 4, // shrinkage toward the average team, in "pseudo-match" units
  iterations: 80,
  damping: 0.7,
  minMatchesPerTeam: 8,
  maxGoals: 10,
  minLambda: 0.15,
  maxLambda: 5,
  // Experimental: weight (0..1) of a shots-based expected-goals estimate (`hx`/`ax` on each
  // result) blended with the real goals the ratings are fitted to. 0 = goals only.
  xgWeight: 0,
  // Dixon-Coles correction: goals in a match are not quite independent, so 0-0, 1-0, 0-1 and
  // 1-1 are re-weighted by this amount (negative = more 0-0 and 1-1, fewer 1-0 and 0-1).
  rho: 0,
  // Both goal rates are multiplied by this before the scoreline matrix is built. The fitted
  // rates run a little low for totals (fewer goals than the market and reality), and the
  // backtest chooses this correction.
  goalScale: 1,
};

const GOAL_LINES = [0.5, 1.5, 2.5, 3.5];
const pct1 = (x) => Math.round(x * 1000) / 10;

/**
 * Probabilities that fall out of a scoreline matrix: home/draw/away (percent, summing to
 * exactly 100) and the goal markets (Over/Under on the usual lines, both teams to score).
 * `matrix[h][a]` is the probability of that exact score; it need not sum to 1.
 */
export function marketsFromMatrix(matrix) {
  const out = [0, 0, 0];
  let total = 0;
  const byTotal = [];
  let btts = 0;
  for (let h = 0; h < matrix.length; h++)
    for (let a = 0; a < matrix[h].length; a++) {
      const p = matrix[h][a];
      total += p;
      out[h > a ? 0 : h === a ? 1 : 2] += p;
      byTotal[h + a] = (byTotal[h + a] ?? 0) + p;
      if (h > 0 && a > 0) btts += p;
    }
  const first = pct1(out[0] / total);
  const second = pct1(out[1] / total);
  const lines = GOAL_LINES.map((line) => {
    let under = 0;
    for (let k = 0; k <= line; k++) under += byTotal[k] ?? 0;
    const over = pct1(1 - under / total);
    return {line, over, under: Math.round((100 - over) * 10) / 10};
  });
  return {
    p: [first, second, Math.round((100 - first - second) * 10) / 10],
    goals: {lines, btts: pct1(btts / total)},
  };
}

/** Distinct, valid regulation-time results from raw football-data matches, before `cutoffMs`. */
export function collectResults(rows, cutoffMs = Infinity) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (r?.id == null || seen.has(r.id)) continue;
    seen.add(r.id);
    const t = Date.parse(r.utcDate);
    const score = fdRegulation(r);
    if (
      !(t < cutoffMs) ||
      !Number.isInteger(score?.home) ||
      !Number.isInteger(score?.away) ||
      score.home < 0 ||
      score.away < 0 ||
      !Number.isInteger(r.homeTeam?.id) ||
      !Number.isInteger(r.awayTeam?.id)
    )
      continue;
    out.push({t, home: r.homeTeam.id, away: r.awayTeam.id, hg: score.home, ag: score.away});
  }
  return out;
}

/**
 * Fits a regularised Poisson attack/defence model with home advantage:
 *   home goals ~ Poisson(exp(mu + home + attack[H] - defence[A]))
 *   away goals ~ Poisson(exp(mu + attack[A] - defence[H]))
 * Matches are weighted by recency; ratings are shrunk toward 0 (the average team).
 */
export function fitRatings(results, now, options = {}) {
  const {halfLifeDays, ridge, iterations, damping, xgWeight} = {...DEFAULTS, ...options};
  const decay = Math.LN2 / (halfLifeDays * DAY);
  const index = new Map();
  for (const r of results)
    for (const id of [r.home, r.away]) if (!index.has(id)) index.set(id, index.size);

  const n = index.size;
  const attack = new Float64Array(n);
  const defence = new Float64Array(n);
  const count = new Float64Array(n);
  // The fitted target is goals, optionally blended with a per-match expected-goals estimate.
  const target = (goals, proxy) =>
    xgWeight > 0 && Number.isFinite(proxy) ? (1 - xgWeight) * goals + xgWeight * proxy : goals;
  const rows = results.map((r) => ({
    h: index.get(r.home),
    a: index.get(r.away),
    hg: target(r.hg, r.hx),
    ag: target(r.ag, r.ax),
    w: Math.exp(-decay * Math.max(0, now - r.t)),
  }));
  for (const m of rows) {
    count[m.h]++;
    count[m.a]++;
  }

  const totalGoals = rows.reduce((s, m) => s + m.w * (m.hg + m.ag), 0);
  const totalWeight = rows.reduce((s, m) => s + 2 * m.w, 0) || 1;
  let mu = Math.log(Math.max(totalGoals / totalWeight, 0.2));
  let home = 0.2;

  for (let it = 0; it < iterations; it++) {
    // Global terms.
    let num = 0;
    let den = 0;
    let hNum = 0;
    let hDen = 0;
    for (const m of rows) {
      const lh = Math.exp(mu + home + attack[m.h] - defence[m.a]);
      const la = Math.exp(mu + attack[m.a] - defence[m.h]);
      num += m.w * (m.hg - lh + (m.ag - la));
      den += m.w * (lh + la);
      hNum += m.w * (m.hg - lh);
      hDen += m.w * lh;
    }
    if (den > 0) mu += damping * (num / den);
    if (hDen > 0) home += damping * (hNum / hDen);

    // Team terms, updated simultaneously with damping.
    const aNum = new Float64Array(n);
    const aDen = new Float64Array(n);
    const dNum = new Float64Array(n);
    const dDen = new Float64Array(n);
    for (const m of rows) {
      const lh = Math.exp(mu + home + attack[m.h] - defence[m.a]);
      const la = Math.exp(mu + attack[m.a] - defence[m.h]);
      aNum[m.h] += m.w * (m.hg - lh);
      aDen[m.h] += m.w * lh;
      aNum[m.a] += m.w * (m.ag - la);
      aDen[m.a] += m.w * la;
      dNum[m.a] += m.w * (m.hg - lh); // goals conceded by the away side's opponent
      dDen[m.a] += m.w * lh;
      dNum[m.h] += m.w * (m.ag - la);
      dDen[m.h] += m.w * la;
    }
    for (let i = 0; i < n; i++) {
      attack[i] += (damping * (aNum[i] - ridge * attack[i])) / (aDen[i] + ridge);
      defence[i] -= (damping * (dNum[i] + ridge * defence[i])) / (dDen[i] + ridge);
    }
  }

  return {mu, home, index, attack, defence, count, matches: rows.length, teams: n};
}

/** Win/draw/lose probabilities (percent, summing to exactly 100) and expected goals. */
export function predictMatch(ratings, homeId, awayId, options = {}) {
  const {minLambda, maxLambda, maxGoals, goalScale} = {...DEFAULTS, ...options};
  const hi = ratings.index.get(homeId);
  const ai = ratings.index.get(awayId);
  if (hi === undefined || ai === undefined) return null;
  const clamp = (x) => Math.min(maxLambda, Math.max(minLambda, x));
  const lh = clamp(
    goalScale * Math.exp(ratings.mu + ratings.home + ratings.attack[hi] - ratings.defence[ai]),
  );
  const la = clamp(goalScale * Math.exp(ratings.mu + ratings.attack[ai] - ratings.defence[hi]));
  const hp = poissonRow(lh, maxGoals);
  const ap = poissonRow(la, maxGoals);
  const rho = clampRho(options.rho ?? DEFAULTS.rho, lh, la);
  const matrix = hp.map((ph, i) => ap.map((pa, j) => ph * pa * dixonColesTau(i, j, lh, la, rho)));
  return {
    ...marketsFromMatrix(matrix),
    scores: scoreMarkets(matrix, {
      rates: [Math.round(lh * 100) / 100, Math.round(la * 100) / 100],
      rho: Math.round(rho * 1000) / 1000,
    }),
    expectedGoals: [Math.round(lh * 100) / 100, Math.round(la * 100) / 100],
  };
}

/**
 * Forecast for one fixture from raw football-data match rows (the two teams' histories plus
 * any other cached histories). Returns null when either team has too little data.
 */
export function ratingsForecast({rows, homeId, awayId, kickoff, now = Date.now(), options = {}}) {
  const opts = {...DEFAULTS, ...options};
  const results = collectResults(rows, Math.min(Date.parse(kickoff), now));
  const involving = (id) => results.filter((r) => r.home === id || r.away === id).length;
  const sampleHome = involving(homeId);
  const sampleAway = involving(awayId);
  if (sampleHome < opts.minMatchesPerTeam || sampleAway < opts.minMatchesPerTeam) return null;

  const ratings = fitRatings(results, now, opts);
  const prediction = predictMatch(ratings, homeId, awayId, opts);
  if (!prediction) return null;
  return {
    ...prediction,
    sampleHome,
    sampleAway,
    teamsRated: ratings.teams,
    matchesUsed: ratings.matches,
    modelVersion: opts.rho ? 'jk-ratings-v3' : 'jk-ratings-v2',
    explanation: `Experimental attack/defence model fitted to ${ratings.matches} recent regulation-time results involving ${ratings.teams} teams (${sampleHome} for the home side, ${sampleAway} for the away side). Recent matches count more and ratings are shrunk toward the average. Backtested on about 1,800 league matches from 2025/26 (five major leagues): clearly better than naive baselines, but a little less accurate than bookmaker closing prices. Not tested on cup or cross-league fixtures; no injury, lineup or rotation adjustment.`,
  };
}
