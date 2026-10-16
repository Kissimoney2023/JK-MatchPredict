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
const probabilityOnPick = (pick) => Number(pick.forecast?.p?.[pick.outcome]);

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

  const byOutcome = OUTCOME_LABELS.map((label, outcome) => {
    const mine = all.filter((p) => p.outcome === outcome);
    const done = mine.filter((p) => p.result === 'correct' || p.result === 'incorrect');
    const hits = done.filter((p) => p.result === 'correct').length;
    return {label, picks: mine.length, settled: done.length, accuracy: rate(hits, done.length)};
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

  const withModel = settled.filter((p) => Array.isArray(p.forecast?.p));
  const following = withModel.filter((p) => p.outcome === favourite(p.forecast.p));
  const against = withModel.filter((p) => p.outcome !== favourite(p.forecast.p));
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
    smallSample: settled.length < MIN_RELIABLE_SAMPLE,
    minReliableSample: MIN_RELIABLE_SAMPLE,
  };
}
