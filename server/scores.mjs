// Scoreline matrices and the markets that fall out of them: correct score and Asian handicap.
// No imports: shared by the ratings model, the forecast service and the tests.

const GRID = 7; // scores 0..6 are shown; the rest is a remainder
const TOP_SCORES = 6;
export const HANDICAP_LINES = [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];
const pct1 = (x) => Math.round(x * 1000) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

/** Dixon-Coles weight for a low scoreline given the two goal rates. 1 for every other score. */
export function dixonColesTau(h, a, lh, la, rho) {
  if (!rho) return 1;
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

export const poissonRow = (lambda, maxGoals) => {
  const p = [Math.exp(-lambda)];
  for (let i = 1; i <= maxGoals; i++) p[i] = (p[i - 1] * lambda) / i;
  return p;
};

/** Keeps rho where every scoreline stays a valid probability. */
export const clampRho = (rho, lh, la) =>
  Math.max(-1 / lh, -1 / la, Math.min(rho, 1 / (lh * la), 1));

/** Joint scoreline probabilities `matrix[h][a]` (normalised) for two goal rates and rho. */
export function buildMatrix(lh, la, rho = 0, maxGoals = 10) {
  const hp = poissonRow(lh, maxGoals);
  const ap = poissonRow(la, maxGoals);
  const r = clampRho(rho, lh, la);
  const matrix = hp.map((ph, i) => ap.map((pa, j) => ph * pa * dixonColesTau(i, j, lh, la, r)));
  const total = matrix.flat().reduce((s, v) => s + v, 0);
  return matrix.map((row) => row.map((v) => v / total));
}

/** Home / draw / away as fractions from a matrix. */
export function outcomeProbabilities(matrix) {
  const out = [0, 0, 0];
  let total = 0;
  for (let h = 0; h < matrix.length; h++)
    for (let a = 0; a < matrix[h].length; a++) {
      total += matrix[h][a];
      out[h > a ? 0 : h === a ? 1 : 2] += matrix[h][a];
    }
  return out.map((v) => v / total);
}

/**
 * The markets shown from a matrix: a 7x7 grid of percentages (home goals down, away goals
 * across), the most likely scorelines with fair odds, and Asian handicap lines from the home
 * side's view (a line of -1.5 means the home side must win by two or more; whole lines can push,
 * and their fair odds exclude the push).
 */
export function scoreMarkets(matrix) {
  const total = matrix.flat().reduce((s, v) => s + v, 0) || 1;
  const p = (h, a) => (matrix[h]?.[a] ?? 0) / total;
  const grid = [];
  const scores = [];
  for (let h = 0; h < GRID; h++) {
    grid.push([]);
    for (let a = 0; a < GRID; a++) {
      grid[h].push(pct1(p(h, a)));
      scores.push({home: h, away: a, p: p(h, a)});
    }
  }
  const top = scores
    .sort((x, y) => y.p - x.p)
    .slice(0, TOP_SCORES)
    .map((s) => ({home: s.home, away: s.away, p: pct1(s.p), fairOdds: round2(1 / s.p)}));
  // From the exact probabilities, so rounding can never make the remainder negative.
  const shown = scores.reduce((sum, x) => sum + x.p, 0);

  const handicaps = HANDICAP_LINES.map((line) => {
    let home = 0;
    let push = 0;
    let away = 0;
    for (let h = 0; h < matrix.length; h++)
      for (let a = 0; a < matrix[h].length; a++) {
        const margin = h - a + line;
        if (margin > 0) home += p(h, a);
        else if (margin === 0) push += p(h, a);
        else away += p(h, a);
      }
    const live = 1 - push;
    return {
      line,
      home: pct1(home),
      push: pct1(push),
      away: pct1(away),
      fairHome: home > 0 ? round2(live / home) : null,
      fairAway: away > 0 ? round2(live / away) : null,
    };
  });
  // The line closest to even money, for the page to highlight.
  const level = handicaps.reduce((best, h) =>
    Math.abs(h.home - h.away) < Math.abs(best.home - best.away) ? h : best,
  );
  return {
    grid,
    remainder: Math.max(0, Math.round((1 - shown) * 1000) / 10),
    top,
    handicaps,
    levelLine: level.line,
  };
}

/**
 * The Poisson rate at which a total line is even money (a quarter line is half a bet on each
 * neighbour; a whole line can push). Used to turn the bookmakers' total into an expected total.
 */
export function rateForTotalLine(total) {
  const line = Number(total);
  if (!Number.isFinite(line) || line <= 0 || line > 8) return null;
  const overUnder = (lambda, l) => {
    let term = Math.exp(-lambda);
    let under = 0;
    let upTo = 0;
    for (let k = 0; k <= Math.floor(l); k++) {
      if (k < l) under += term;
      upTo += term;
      term = (term * lambda) / (k + 1);
    }
    return {over: 1 - upTo, under};
  };
  const quarter = Math.round(line * 4) % 2 === 1;
  const at = (lambda) => {
    if (!quarter) return overUnder(lambda, line);
    const a = overUnder(lambda, line - 0.25);
    const b = overUnder(lambda, line + 0.25);
    return {over: (a.over + b.over) / 2, under: (a.under + b.under) / 2};
  };
  let lo = 0.1;
  let hi = 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const {over, under} = at(mid);
    if (over > under) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A scoreline matrix that reproduces a three-way line and a total line: the home and away goal
 * rates share the total implied by the line, the split is solved for the home-win chance and
 * the low-score correction for the draw chance. Null when the inputs are unusable. `p` is in
 * percent.
 */
export function matrixFromMarkets(p, total) {
  const rate = rateForTotalLine(total);
  const ph = Number(p?.[0]) / 100;
  const pd = Number(p?.[1]) / 100;
  if (!rate || !(ph > 0) || !(pd > 0) || ph + pd >= 1) return null;
  let rho = 0;
  let lh = rate / 2;
  for (let round = 0; round < 12; round++) {
    // Home rate (the away rate is the remainder) for the home-win chance: monotone.
    let lo = 0.05 * rate;
    let hi = 0.95 * rate;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const [home] = outcomeProbabilities(buildMatrix(mid, rate - mid, rho));
      if (home < ph) lo = mid;
      else hi = mid;
    }
    lh = (lo + hi) / 2;
    // Rho for the draw chance: draws grow as rho falls (0-0 and 1-1 gain weight).
    const la = rate - lh;
    let rlo = Math.max(-0.6, -1 / lh + 0.001, -1 / la + 0.001);
    let rhi = Math.min(0.6, 1 / (lh * la) - 0.001, 0.999);
    for (let i = 0; i < 40; i++) {
      const mid = (rlo + rhi) / 2;
      const [, draw] = outcomeProbabilities(buildMatrix(lh, la, mid));
      if (draw > pd) rlo = mid;
      else rhi = mid;
    }
    rho = (rlo + rhi) / 2;
  }
  const la = rate - lh;
  return {
    matrix: buildMatrix(lh, la, rho),
    rates: [round2(lh), round2(la)],
    rho: Math.round(rho * 1000) / 1000,
    fitted: outcomeProbabilities(buildMatrix(lh, la, rho)).map(pct1),
  };
}
