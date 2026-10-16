// Pure SVG builder for the "accuracy over time" chart. No imports and no DOM, so it can be unit
// tested in Node. Like analysis.mjs and pickstats.mjs it is also published to the browser
// (as /trend.js), and the public share page uses it on the server. Colours come from CSS classes, because the page's CSP forbids inline styles.

const FIRST_PLOTTED = 3; // the first picks swing between 0% and 100%; start once there are three
const MIN_SETTLED = 5;
const LEFT = 36;
const RIGHT = 10;
const TOP = 10;
const BOTTOM = 24;

const pct = (v) => Math.round(v * 100);

/**
 * Line chart of cumulative accuracy (solid) against what the forecasts expected (dashed), after
 * each settled pick. `points` come from accuracyTrend(). Returns '' when there is too little to
 * draw. Every number is computed here, so the markup contains no user text.
 */
export function trendChart(points, {width = 640, height = 220} = {}) {
  // Only finite numbers are drawn: a malformed series (for example from a stored snapshot)
  // produces no chart rather than odd markup.
  const clean = (Array.isArray(points) ? points : [])
    .filter((p) =>
      [p?.n, p?.accuracy, p?.expected].every((v) => typeof v === 'number' && Number.isFinite(v)),
    )
    .map((p) => ({n: Math.trunc(p.n), accuracy: p.accuracy, expected: p.expected}));
  if (clean.length < MIN_SETTLED) return '';
  const shown = clean.filter((p) => p.n >= FIRST_PLOTTED);
  if (!shown.length) return '';
  const plotW = width - LEFT - RIGHT;
  const plotH = height - TOP - BOTTOM;
  const x = (i) => LEFT + (shown.length === 1 ? 0 : (i / (shown.length - 1)) * plotW);
  const y = (v) => TOP + (1 - Math.min(1, Math.max(0, v))) * plotH;
  const line = (key) => shown.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (v) =>
        `<line class="trend-grid" x1="${LEFT}" x2="${width - RIGHT}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" />` +
        `<text class="trend-axis" x="${LEFT - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11">${pct(v)}%</text>`,
    )
    .join('');
  const first = shown[0];
  const last = shown.at(-1);
  const ends =
    `<text class="trend-axis" x="${LEFT}" y="${height - 6}" text-anchor="start" font-size="11">after ${first.n} picks</text>` +
    `<text class="trend-axis" x="${width - RIGHT}" y="${height - 6}" text-anchor="end" font-size="11">after ${last.n}</text>`;

  const label =
    `Accuracy after each settled pick: ${pct(first.accuracy)}% after ${first.n} picks, ` +
    `${pct(last.accuracy)}% after ${last.n}. The forecasts expected ${pct(last.expected)}%.`;
  return (
    `<svg class="trend" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid meet">` +
    grid +
    `<polyline class="trend-expected" fill="none" points="${line('expected')}" />` +
    `<polyline class="trend-accuracy" fill="none" points="${line('accuracy')}" />` +
    `<circle class="trend-dot" cx="${x(shown.length - 1).toFixed(1)}" cy="${y(last.accuracy).toFixed(1)}" r="4" />` +
    ends +
    '</svg>'
  );
}

/** The chart with its heading and legend, or '' when there is too little to draw. */
export function trendBlock(points, {mine = true} = {}) {
  const chart = trendChart(points);
  if (!chart) return '';
  const who = mine ? 'Your accuracy so far' : 'Accuracy so far';
  return `<div class="stat-block"><h4>Accuracy over time</h4>${chart}<p class="muted trend-legend"><span class="key accuracy"></span> ${who} <span class="key expected"></span> What the forecasts expected for these picks. Starts at the third settled pick.</p></div>`;
}
