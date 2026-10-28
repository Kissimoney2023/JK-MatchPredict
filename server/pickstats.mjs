// Pure statistics over a person's virtual picks. No imports: this file is also published to
// the browser (as /pickstats.js), like analysis.mjs.

const Z95 = 1.96;
const MIN_RELIABLE_SAMPLE = 20;
const RECENT_COUNT = 10;
const MAX_COMPETITIONS = 8;
const OUTCOME_LABELS = ['Home win', 'Draw', 'Away win'];
const BANDS = [
  {label: 'Under 40%', min: 0, max: 40},
  {label: '40–50%', min: 40, max: 50},
  {label: '50–60%', min: 50, max: 60},
  {label: '60% and over', min: 60, max: 101},
];

/** Wilson 95% interval for a proportion: honest about small samples, unlike a bare percentage. */
export function wilson(successes, n) {
  if (!n) return null;
  const p = successes / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return {rate: p, low: Math.max(0, center - half), high: Math.min(1, center + half)};
}

const rate = (correct, settled) => (settled ? correct / settled : null);
const favourite = (p) => p.indexOf(Math.max(...p));
const kickoff = (pick) => Date.parse(pick.forecast?.kickoff) || pick.createdAt || 0;

/**
 * The market a pick is in: 'result' (home/draw/away), 'totals' (over/under a goal line) or
 * 'selection' (any betting-slip cell, by its id).
 */
export const pickMarket = (pick) =>
  pick?.market === 'totals' ? 'totals' : pick?.market === 'selection' ? 'selection' : 'result';

const RESULT_SYMBOLS = ['1', 'X', '2'];
const SELECTION_KINDS = {
  dc: 'Double chance',
  btts: 'Both teams score',
  hcap: 'Handicap',
  htft: 'HT/FT',
  score: 'Correct score',
  fh: '1st half',
};

/** A betting-slip selection id in words, with the forecast's team names. */
export function selectionLabel(id, f = {}) {
  const [kind, ...rest] = String(id ?? '').split(':');
  const results = [`${f.home} win`, 'Draw', `${f.away} win`];
  const sides = [f.home, 'Draw', f.away];
  const overUnder = (side, line) => `${side === 'over' ? 'Over' : 'Under'} ${line} goals`;
  switch (kind) {
    case 'result':
      return results[Number(rest[0])] ?? 'Pick';
    case 'dc':
      return (
        {'1X': `${f.home} or draw (1X)`, 12: 'Either team wins (12)', X2: `Draw or ${f.away} (X2)`}[
          rest[0]
        ] ?? 'Double chance'
      );
    case 'btts':
      return `Both teams score: ${rest[0] === 'yes' ? 'Yes' : 'No'}`;
    case 'total':
      return overUnder(rest[0], rest[1]);
    case 'hcap':
      return `Handicap ${rest[0]}:${rest[1]} · ${sides[RESULT_SYMBOLS.indexOf(rest[2])] ?? rest[2]}`;
    case 'htft':
      return `Half-time/full-time ${RESULT_SYMBOLS[rest[0]]}/${RESULT_SYMBOLS[rest[1]]}`;
    case 'score':
      return `Correct score ${rest[0]}:${rest[1]}`;
    case 'fh': {
      const [what, ...more] = rest;
      if (what === 'result')
        return (
          [`${f.home} wins the 1st half`, '1st half draw', `${f.away} wins the 1st half`][
            Number(more[0])
          ] ?? '1st half'
        );
      if (what === 'total') return `${overUnder(more[0], more[1])} · 1st half`;
      if (what === 'btts') return `Both score in the 1st half: ${more[0] === 'yes' ? 'Yes' : 'No'}`;
      return '1st half';
    }
    default:
      return 'Pick';
  }
}

/** What was picked, in words: "Arsenal win", "Draw", "Over 2.5 goals", "Handicap 0:1 · Draw". */
export function pickLabel(pick) {
  const f = pick?.forecast ?? {};
  if (pickMarket(pick) === 'selection') return selectionLabel(pick.selection, f);
  if (pickMarket(pick) === 'totals')
    return `${pick.outcome === 0 ? 'Over' : 'Under'} ${pick.line} goals`;
  return [`${f.home} win`, 'Draw', `${f.away} win`][pick?.outcome] ?? 'Pick';
}

/** The price the pick was placed at (decimal odds), or null when none was recorded. */
export function pickPrice(pick) {
  const v = Number(pick?.price);
  return Number.isFinite(v) && v > 1 ? v : null;
}

/** The forecast's chance (percent) for what was picked, or NaN when the forecast has none. */
export function pickProbability(pick) {
  const f = pick?.forecast;
  if (pickMarket(pick) === 'selection') return Number(pick.probability);
  if (pickMarket(pick) === 'totals') {
    const line = f?.goals?.lines?.find((l) => Number(l.line) === Number(pick.line));
    return line ? Number(pick.outcome === 0 ? line.over : line.under) : NaN;
  }
  return Number(f?.p?.[pick?.outcome]);
}

/** Whether the pick sided with the forecast (for totals: the side it put above 50%); null if unknown. */
export function pickFollowsForecast(pick) {
  if (pickMarket(pick) === 'totals' || pickMarket(pick) === 'selection') {
    const p = pickProbability(pick);
    return Number.isFinite(p) ? p >= 50 : null;
  }
  const p = pick?.forecast?.p;
  return Array.isArray(p) ? pick.outcome === favourite(p) : null;
}

/** Short name of the kind of pick, for grouping: "Home win", "Draw", "Away win", "Over 2.5". */
export function pickKind(pick) {
  if (pickMarket(pick) === 'selection') {
    const [kind, ...rest] = String(pick.selection ?? '').split(':');
    if (kind === 'result') return OUTCOME_LABELS[Number(rest[0])] ?? 'Other';
    if (kind === 'total') return `${rest[0] === 'over' ? 'Over' : 'Under'} ${rest[1]}`;
    return SELECTION_KINDS[kind] ?? 'Other';
  }
  if (pickMarket(pick) === 'totals') return `${pick.outcome === 0 ? 'Over' : 'Under'} ${pick.line}`;
  return OUTCOME_LABELS[pick?.outcome] ?? 'Other';
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * The picks placed together as slips (by their slip label): per slip the legs, how many won,
 * lost, are pending or void, the status of the whole slip (lost as soon as one leg loses; won
 * only when every live leg has won), the combined price when every live leg has one, and the
 * chance of the whole slip at placement with its fair odds. Newest slip first.
 */
export function slipsSummary(picks) {
  const withSlip = (Array.isArray(picks) ? picks : []).filter(
    (p) => typeof p?.slip === 'string' && p.slip.trim(),
  );
  const groups = new Map();
  for (const p of withSlip) groups.set(p.slip, [...(groups.get(p.slip) ?? []), p]);
  const slips = [...groups]
    .map(([label, legs]) => {
      const live = legs.filter((p) => p.result !== 'void');
      const correct = live.filter((p) => p.result === 'correct').length;
      const incorrect = live.filter((p) => p.result === 'incorrect').length;
      const pending = live.filter((p) => !p.result).length;
      const status = incorrect ? 'lost' : !live.length ? 'void' : pending ? 'pending' : 'won';
      const prices = live.map(pickPrice);
      const price =
        live.length && prices.every((x) => x) ? round2(prices.reduce((a, b) => a * b, 1)) : null;
      const chances = live.map(pickProbability);
      const probability =
        live.length && chances.every((x) => Number.isFinite(x) && x > 0)
          ? round2(chances.reduce((a, b) => a * (b / 100), 1) * 100)
          : null;
      return {
        label,
        legs,
        n: legs.length,
        correct,
        incorrect,
        pending,
        void: legs.length - live.length,
        status,
        price,
        probability,
        fairOdds: probability ? round2(100 / probability) : null,
        lostLegs: live.filter((p) => p.result === 'incorrect'),
        latest: Math.max(...legs.map(kickoff)),
      };
    })
    .sort((a, b) => b.latest - a.latest);
  const count = (status) => slips.filter((s) => s.status === status).length;
  return {
    slips,
    won: count('won'),
    lost: count('lost'),
    pending: count('pending'),
    legsSettled: slips.reduce((s, x) => s + x.correct + x.incorrect, 0),
    legsCorrect: slips.reduce((s, x) => s + x.correct, 0),
  };
}

const probabilityOnPick = pickProbability;

/**
 * Closing line value across picks that carry one (`pick.clv`, attached by the server): the
 * average movement of the bookmakers' consensus toward the pick between pick and kickoff, and
 * how often it moved that way at all. Positive on average, over many picks, is the one sign
 * of judgement that does not depend on results.
 */
export function closingLineSummary(picks) {
  const withClv = (Array.isArray(picks) ? picks : []).filter((p) => Number.isFinite(p?.clv?.value));
  if (!withClv.length) return null;
  const n = withClv.length;
  const beat = withClv.filter((p) => p.clv.beatClose).length;
  return {
    n,
    averageValue: Math.round((withClv.reduce((s, p) => s + p.clv.value, 0) / n) * 1000) / 1000,
    beatClose: beat,
    beatCloseRate: Math.round((beat / n) * 1000) / 1000,
  };
}

/** Groups settled picks and reports count, correct picks and accuracy for each group. */
function groupBy(settled, keyOf) {
  const groups = new Map();
  for (const pick of settled) {
    const key = keyOf(pick);
    if (key === null) continue;
    const g = groups.get(key) ?? {key, settled: 0, correct: 0, predictedSum: 0};
    g.settled++;
    if (pick.result === 'correct') g.correct++;
    g.predictedSum += probabilityOnPick(pick) || 0;
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * Running accuracy after each settled pick (oldest first, by match date) next to what the
 * forecasts expected on average for the same picks. Void and pending picks are not counted.
 */
export function accuracyTrend(picks) {
  const settled = (Array.isArray(picks) ? picks : [])
    .filter((p) => p.result === 'correct' || p.result === 'incorrect')
    .sort((a, b) => kickoff(a) - kickoff(b));
  let hits = 0;
  let expected = 0;
  return settled.map((p, i) => {
    if (p.result === 'correct') hits++;
    expected += (probabilityOnPick(p) || 0) / 100;
    return {n: i + 1, accuracy: hits / (i + 1), expected: expected / (i + 1)};
  });
}

/**
 * Summary of a person's picks. Only picks with a result of correct or incorrect count towards
 * accuracy; void picks (cancelled matches) and pending picks are reported separately.
 */
export function summarizePicks(picks) {
  const all = Array.isArray(picks) ? picks : [];
  const settled = all.filter((p) => p.result === 'correct' || p.result === 'incorrect');
  const correct = settled.filter((p) => p.result === 'correct').length;
  const chronological = [...settled].sort((a, b) => kickoff(a) - kickoff(b));

  // Streaks, by match date.
  let best = 0;
  let run = 0;
  for (const p of chronological) {
    run = p.result === 'correct' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let currentStreak = null;
  if (chronological.length) {
    const lastResult = chronological.at(-1).result;
    let length = 0;
    for (let i = chronological.length - 1; i >= 0 && chronological[i].result === lastResult; i--)
      length++;
    currentStreak = {type: lastResult, length};
  }

  // Home win / Draw / Away win always, then any Over/Under kinds that were actually picked.
  const kinds = [...OUTCOME_LABELS];
  for (const p of all) if (!kinds.includes(pickKind(p))) kinds.push(pickKind(p));
  const byOutcome = kinds.map((label) => {
    const mine = all.filter((p) => pickKind(p) === label);
    const done = mine.filter((p) => p.result === 'correct' || p.result === 'incorrect');
    const hits = done.filter((p) => p.result === 'correct').length;
    return {
      label,
      picks: mine.length,
      settled: done.length,
      correct: hits,
      accuracy: rate(hits, done.length),
    };
  });

  const byCompetition = groupBy(settled, (p) => p.forecast?.competition ?? null)
    .map((g) => ({
      name: g.key,
      settled: g.settled,
      correct: g.correct,
      accuracy: rate(g.correct, g.settled),
    }))
    .sort((a, b) => b.settled - a.settled || a.name.localeCompare(b.name))
    .slice(0, MAX_COMPETITIONS);

  const byConfidence = BANDS.map((band) => {
    const inBand = settled.filter((p) => {
      const v = probabilityOnPick(p);
      return Number.isFinite(v) && v >= band.min && v < band.max;
    });
    const hits = inBand.filter((p) => p.result === 'correct').length;
    const avg = inBand.length
      ? inBand.reduce((s, p) => s + probabilityOnPick(p), 0) / inBand.length / 100
      : null;
    return {
      range: band.label,
      settled: inBand.length,
      correct: hits,
      accuracy: rate(hits, inBand.length),
      averagePredicted: avg,
    };
  }).filter((b) => b.settled > 0);

  const withModel = settled.filter((p) => pickFollowsForecast(p) !== null);
  const following = withModel.filter((p) => pickFollowsForecast(p));
  const against = withModel.filter((p) => !pickFollowsForecast(p));
  const hitRate = (list) => rate(list.filter((p) => p.result === 'correct').length, list.length);

  const expected = settled.reduce((s, p) => s + (probabilityOnPick(p) || 0) / 100, 0);

  return {
    total: all.length,
    pending: all.filter((p) => !p.result).length,
    voided: all.filter((p) => p.result === 'void').length,
    settled: settled.length,
    correct,
    incorrect: settled.length - correct,
    accuracy: wilson(correct, settled.length),
    currentStreak,
    bestWinStreak: best,
    recent: [...chronological]
      .reverse()
      .slice(0, RECENT_COUNT)
      .map((p) => p.result),
    byOutcome,
    byCompetition,
    byConfidence,
    followedModel: {
      following: {settled: following.length, accuracy: hitRate(following)},
      against: {settled: against.length, accuracy: hitRate(against)},
    },
    expectedCorrect: Math.round(expected * 10) / 10,
    closingLine: closingLineSummary(all),
    smallSample: settled.length < MIN_RELIABLE_SAMPLE,
    minReliableSample: MIN_RELIABLE_SAMPLE,
  };
}
