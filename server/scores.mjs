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
export function scoreMarkets(matrix, {rates, rho} = {}) {
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
    // The goal rates and low-score correction the matrix came from, so the browser can rebuild
    // it for the bookmaker-style markets and same-match combinations. Absent on older records.
    ...(Array.isArray(rates) ? {rates, rho: rho ?? 0} : {}),
  };
}

// ---- Bookmaker-style markets ------------------------------------------------------------------
//
// The markets a Swiss betting slip offers (Sporttip's list, in its order and wording), each with
// the forecast's chance and the fair price, so a price on the slip can be compared by eye.

/** Share of a match's goals scored before the break: about 45% in the big leagues. */
export const FIRST_HALF_SHARE = 0.45;
const OU_LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
const FIRST_HALF_OU_LINES = [0.5, 1.5, 2.5];
// "0:1" means the away side starts a goal up, as the slip prints it.
const HANDICAP_STARTS = [
  [0, 3],
  [0, 2],
  [0, 1],
  [1, 0],
  [2, 0],
  [3, 0],
];
const TOP_CORRECT_SCORES = 12;
const RESULT = ['1', 'X', '2'];
const MIN_SHOWN = 0.1; // percent; a cell below this is left out like a locked price

const fairOf = (percent) => (percent > 0 ? round2(100 / percent) : null);
const cellOf = (id, label, fraction) => {
  const p = pct1(fraction);
  return {id, label, p, fair: fairOf(p)};
};
const sumWhere = (matrix, test) => {
  let s = 0;
  for (let h = 0; h < matrix.length; h++)
    for (let a = 0; a < matrix[h].length; a++) if (test(h, a)) s += matrix[h][a];
  return s;
};
const complete = (cells) => cells.every((c) => c.p >= MIN_SHOWN);

function totalsRows(matrix, lines, prefix) {
  return lines
    .map((line) => ({
      label: String(line),
      cells: [
        cellOf(
          `${prefix}:over:${line}`,
          'Over',
          sumWhere(matrix, (h, a) => h + a > line),
        ),
        cellOf(
          `${prefix}:under:${line}`,
          'Under',
          sumWhere(matrix, (h, a) => h + a < line),
        ),
      ],
    }))
    .filter((r) => complete(r.cells));
}

const bttsRow = (matrix, prefix) => {
  const yes = sumWhere(matrix, (h, a) => h > 0 && a > 0);
  return {
    label: '',
    cells: [cellOf(`${prefix}:yes`, 'Yes', yes), cellOf(`${prefix}:no`, 'No', 1 - yes)],
  };
};

const resultRow = (prefix, [h, d, a], names) => ({
  label: '',
  cells: [
    cellOf(`${prefix}:0`, names[0], h),
    cellOf(`${prefix}:1`, names[1], d),
    cellOf(`${prefix}:2`, names[2], a),
  ],
});

/**
 * Halftime/fulltime chances: the two halves are independent Poisson periods sharing the
 * match's goal rates, then each full-time column is scaled to the forecast's own result
 * chances so the nine cells agree with the headline. Fractions, indexed [ht][ft].
 */
function halfFullTable(rates, rho, p) {
  const first = buildMatrix(rates[0] * FIRST_HALF_SHARE, rates[1] * FIRST_HALF_SHARE, rho);
  const second = buildMatrix(
    rates[0] * (1 - FIRST_HALF_SHARE),
    rates[1] * (1 - FIRST_HALF_SHARE),
    rho,
  );
  const outcome = (h, a) => (h > a ? 0 : h === a ? 1 : 2);
  const table = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let h1 = 0; h1 < first.length; h1++)
    for (let a1 = 0; a1 < first[h1].length; a1++)
      for (let h2 = 0; h2 < second.length; h2++)
        for (let a2 = 0; a2 < second[h2].length; a2++)
          table[outcome(h1, a1)][outcome(h1 + h2, a1 + a2)] += first[h1][a1] * second[h2][a2];
  for (let ft = 0; ft < 3; ft++) {
    const column = table[0][ft] + table[1][ft] + table[2][ft];
    const target = p[ft] / 100;
    if (column > 0) for (let ht = 0; ht < 3; ht++) table[ht][ft] *= target / column;
  }
  return table;
}

/**
 * The markets a betting slip offers for this match, from the forecast's result chances and its
 * scoreline matrix (rebuilt from `scores.rates` and `scores.rho`). Each group has rows of cells
 * `{id, label, p, fair}`; ids are stable keys the same-match combination builder understands.
 * Empty when the record has no goal rates. Names are the slip's own wording.
 */
export function bettingMarkets(f) {
  const rates = f?.scores?.rates;
  const p = f?.p;
  if (!Array.isArray(rates) || rates.length !== 2 || !Array.isArray(p) || p.length !== 3) return [];
  const rho = f.scores.rho ?? 0;
  const full = buildMatrix(rates[0], rates[1], rho);
  const half = buildMatrix(rates[0] * FIRST_HALF_SHARE, rates[1] * FIRST_HALF_SHARE, rho);
  const names = [f.home, 'Draw', f.away];
  const scored = 1 - full[0][0];
  const share = rates[0] / (rates[0] + rates[1]);
  const htft = halfFullTable(rates, rho, p);
  const grid = f.scores.grid ?? scoreMarkets(full).grid;
  const groups = [
    {
      id: 'result',
      title: 'Final Result',
      rows: [
        resultRow(
          'result',
          p.map((x) => x / 100),
          names,
        ),
      ],
    },
    {
      id: 'doubleChance',
      title: 'Double Chance',
      rows: [
        {
          label: '',
          cells: [
            cellOf('dc:1X', '1X', (p[0] + p[1]) / 100),
            cellOf('dc:12', '12', (p[0] + p[2]) / 100),
            cellOf('dc:X2', 'X2', (p[1] + p[2]) / 100),
          ],
        },
      ],
    },
    {id: 'btts', title: 'Both Teams to score', rows: [bttsRow(full, 'btts')]},
    {id: 'totals', title: 'Over/Under', rows: totalsRows(full, OU_LINES, 'total')},
    {
      id: 'handicap',
      title: 'Handicap',
      rows: HANDICAP_STARTS.map(([hs, as]) => {
        const line = hs - as;
        const cells = RESULT.map((name, i) =>
          cellOf(
            `hcap:${hs}:${as}:${name}`,
            name,
            sumWhere(full, (h, a) => {
              const margin = h - a + line;
              return i === 0 ? margin > 0 : i === 1 ? margin === 0 : margin < 0;
            }),
          ),
        );
        return {label: `${hs}:${as}`, cells};
      }).filter((r) => complete(r.cells)),
    },
    {
      id: 'halfFull',
      title: 'Halftime / Fulltime',
      rows: RESULT.map((ht, i) => ({
        label: '',
        cells: RESULT.map((ft, j) => cellOf(`htft:${i}:${j}`, `${ht}/${ft}`, htft[i][j])),
      })),
    },
    {
      id: 'firstHalfResult',
      title: 'Who wins the 1st Half',
      rows: [resultRow('fh:result', outcomeProbabilities(half), names)],
    },
    {
      id: 'firstHalfTotals',
      title: '1st half – Over/Under',
      rows: totalsRows(half, FIRST_HALF_OU_LINES, 'fh:total'),
    },
    {
      id: 'firstHalfBtts',
      title: '1st Half – Both Teams to Score',
      rows: [bttsRow(half, 'fh:btts')],
    },
    {
      id: 'firstGoal',
      title: 'Which Team will score the 1st Goal?',
      rows: [
        {
          label: '',
          cells: [
            cellOf('first:0', f.home, scored * share),
            cellOf('first:none', 'None', full[0][0]),
            cellOf('first:2', f.away, scored * (1 - share)),
          ],
        },
      ],
    },
    {
      id: 'correctScore',
      title: 'Correct Score',
      rows: [
        {
          label: '',
          cells: grid
            .flatMap((row, h) => row.map((pc, a) => ({h, a, pc})))
            .sort((x, y) => y.pc - x.pc)
            .slice(0, TOP_CORRECT_SCORES)
            .map(({h, a, pc}) => cellOf(`score:${h}:${a}`, `${h}:${a}`, pc / 100)),
        },
      ],
    },
  ];
  // Keep only complete books: a locked cell would make the group misleading.
  return groups
    .map((g) => ({...g, rows: g.rows.filter((r) => r.cells.every((c) => c.p >= MIN_SHOWN))}))
    .filter((g) => g.rows.length);
}

/** Test for one full-time selection id against a scoreline, or null for ids not on full time. */
function fullTimeTest(id) {
  const [kind, ...rest] = String(id).split(':');
  if (kind === 'result') {
    const n = Number(rest[0]);
    return (h, a) => (h > a ? 0 : h === a ? 1 : 2) === n;
  }
  if (kind === 'dc')
    return (
      {
        '1X': (h, a) => h >= a,
        12: (h, a) => h !== a,
        X2: (h, a) => a >= h,
      }[rest[0]] ?? null
    );
  if (kind === 'btts')
    return rest[0] === 'yes' ? (h, a) => h > 0 && a > 0 : (h, a) => h === 0 || a === 0;
  if (kind === 'total') {
    const line = Number(rest[1]);
    return rest[0] === 'over' ? (h, a) => h + a > line : (h, a) => h + a < line;
  }
  if (kind === 'hcap') {
    const line = Number(rest[0]) - Number(rest[1]);
    const side = rest[2];
    return (h, a) => {
      const margin = h - a + line;
      return side === '1' ? margin > 0 : side === 'X' ? margin === 0 : margin < 0;
    };
  }
  if (kind === 'score') return (h, a) => h === Number(rest[0]) && a === Number(rest[1]);
  return null;
}

/**
 * The chance (percent) that every selection in a same-match combination wins, counted over the
 * scorelines where all of them hold, which is what a bet builder is worth. Multiplying the
 * legs would be wrong: a draw and both teams scoring are not independent. Null when a
 * selection is not a full-time market or the record has no goal rates.
 */
export function comboProbability(ids, f) {
  const rates = f?.scores?.rates;
  if (!Array.isArray(rates) || rates.length !== 2 || !Array.isArray(ids) || !ids.length)
    return null;
  const tests = ids.map(fullTimeTest);
  if (tests.some((t) => !t)) return null;
  const full = buildMatrix(rates[0], rates[1], f.scores.rho ?? 0);
  return pct1(sumWhere(full, (h, a) => tests.every((t) => t(h, a))));
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
