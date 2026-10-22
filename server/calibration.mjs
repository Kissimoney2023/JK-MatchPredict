// Running calibration of forecasts: compact aggregates that grow one settled match at a time,
// and the reliability chart drawn from them. No imports: also published to the browser
// (as /calibration.js) for the chart, like trend.mjs.

const BINS = 10;
const EPS = 1e-6;
const MIN_BIN = 5; // a bin is drawn once it holds this many forecasts
const MIN_CHART = 3; // and a chart once this many bins are drawn
export const OUTCOME_LABELS = ['Home win', 'Draw', 'Away win'];

const bin = () => ({sum: 0, hits: 0, n: 0});
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

/** A fresh aggregate for one source. */
export function emptyAggregate() {
  return {
    n: 0,
    logLoss: 0,
    brier: 0,
    correct: 0,
    bins: Array.from({length: BINS}, bin),
    said: [0, 0, 0],
    happened: [0, 0, 0],
    totals: {n: 0, logLoss: 0, said: 0, happened: 0, bins: Array.from({length: BINS}, bin)},
  };
}

/**
 * Adds one settled match. `p` are the three chances as fractions, `outcome` 0/1/2 what
 * happened; `over25` (fraction) and `overHappened` are optional. Returns the aggregate.
 */
export function addResult(agg, p, outcome, over25 = null, overHappened = null) {
  if (!Array.isArray(p) || p.length !== 3 || ![0, 1, 2].includes(outcome)) return agg;
  const q = p.map((v) => Math.min(1 - EPS, Math.max(EPS, Number(v) || 0)));
  agg.n++;
  agg.logLoss += -Math.log(q[outcome]);
  agg.brier += q.reduce((s, v, i) => s + (v - (i === outcome ? 1 : 0)) ** 2, 0);
  agg.correct += q.indexOf(Math.max(...q)) === outcome ? 1 : 0;
  q.forEach((v, i) => {
    const b = agg.bins[Math.min(BINS - 1, Math.floor(v * BINS))];
    b.sum += v;
    b.n++;
    if (i === outcome) b.hits++;
    agg.said[i] += v;
  });
  agg.happened[outcome]++;
  if (Number.isFinite(over25) && typeof overHappened === 'boolean') {
    const o = Math.min(1 - EPS, Math.max(EPS, over25));
    const t = agg.totals;
    t.n++;
    t.logLoss += -Math.log(overHappened ? o : 1 - o);
    t.said += o;
    if (overHappened) t.happened++;
    const b = t.bins[Math.min(BINS - 1, Math.floor(o * BINS))];
    b.sum += o;
    b.n++;
    if (overHappened) b.hits++;
  }
  return agg;
}

const binRows = (bins) =>
  bins
    .map((b, i) => ({
      range: `${i * 10}-${i * 10 + 10}%`,
      predicted: b.n ? round(b.sum / b.n, 4) : null,
      observed: b.n ? round(b.hits / b.n, 4) : null,
      n: b.n,
    }))
    .filter((b) => b.n);

/** Readable numbers from an aggregate (rates as fractions). */
export function summarizeAggregate(agg) {
  if (!agg?.n) return {n: 0};
  const n = agg.n;
  const t = agg.totals ?? {n: 0};
  return {
    n,
    accuracy: round(agg.correct / n, 4),
    logLoss: round(agg.logLoss / n, 4),
    brier: round(agg.brier / n, 4),
    bins: binRows(agg.bins),
    outcomes: OUTCOME_LABELS.map((label, i) => ({
      label,
      said: round(agg.said[i] / n, 4),
      happened: round(agg.happened[i] / n, 4),
    })),
    totals: t.n
      ? {
          n: t.n,
          logLoss: round(t.logLoss / t.n, 4),
          said: round(t.said / t.n, 4),
          happened: round(t.happened / t.n, 4),
          bins: binRows(t.bins),
        }
      : null,
    small: n < 50,
  };
}

/**
 * Reliability chart: for each bin, the average chance the source said against how often it
 * happened, with the diagonal of perfect calibration. Colours come from CSS classes (the
 * page's security policy forbids inline styles). '' when there is too little to draw.
 */
export function reliabilityChart(bins, {width = 320, height = 300} = {}) {
  const drawn = (Array.isArray(bins) ? bins : []).filter(
    (b) => b && b.n >= MIN_BIN && Number.isFinite(b.predicted) && Number.isFinite(b.observed),
  );
  if (drawn.length < MIN_CHART) return '';
  const LEFT = 40;
  const RIGHT = 10;
  const TOP = 10;
  const BOTTOM = 32;
  const w = width - LEFT - RIGHT;
  const h = height - TOP - BOTTOM;
  const x = (v) => LEFT + v * w;
  const y = (v) => TOP + (1 - v) * h;
  const maxN = Math.max(...drawn.map((b) => b.n));
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (v) =>
        `<line class="cal-grid" x1="${LEFT}" x2="${width - RIGHT}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" />` +
        `<line class="cal-grid" y1="${TOP}" y2="${height - BOTTOM}" x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" />` +
        `<text class="cal-axis" x="${LEFT - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11">${Math.round(v * 100)}%</text>` +
        `<text class="cal-axis" x="${x(v).toFixed(1)}" y="${height - 14}" text-anchor="middle" font-size="11">${Math.round(v * 100)}%</text>`,
    )
    .join('');
  const diagonal = `<line class="cal-diagonal" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" />`;
  const points = drawn
    .map((b) => {
      const r = 3 + 7 * Math.sqrt(b.n / maxN);
      return `<circle class="cal-point" cx="${x(b.predicted).toFixed(1)}" cy="${y(b.observed).toFixed(1)}" r="${r.toFixed(1)}"><title>said ${Math.round(b.predicted * 100)}%, happened ${Math.round(b.observed * 100)}% (${b.n})</title></circle>`;
    })
    .join('');
  const line = `<polyline class="cal-line" fill="none" points="${drawn.map((b) => `${x(b.predicted).toFixed(1)},${y(b.observed).toFixed(1)}`).join(' ')}" />`;
  const label = drawn
    .map(
      (b) =>
        `said ${Math.round(b.predicted * 100)}% happened ${Math.round(b.observed * 100)}% (${b.n})`,
    )
    .join('; ');
  return (
    `<svg class="cal" viewBox="0 0 ${width} ${height}" role="img" aria-label="Reliability: ${label}. Along the diagonal is perfectly calibrated." preserveAspectRatio="xMidYMid meet">` +
    grid +
    diagonal +
    line +
    points +
    `<text class="cal-axis" x="${width - RIGHT}" y="${height - 2}" text-anchor="end" font-size="10">what the forecast said</text>` +
    '</svg>'
  );
}
