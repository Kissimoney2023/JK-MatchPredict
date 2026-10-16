import test from 'node:test';
import assert from 'node:assert/strict';
import {accuracyTrend} from '../server/pickstats.mjs';
import {trendChart} from '../public/js/trend.js';

let n = 0;
/** A settled pick; kickoff order follows `day`, the probability is the chance on the pick. */
const pick = (day, result, probability = 50) => ({
  id: 'p' + ++n,
  outcome: 0,
  result,
  createdAt: 0,
  forecast: {kickoff: new Date(Date.UTC(2026, 8, day)).toISOString(), p: [probability, 25, 25]},
});

test('the trend is the running accuracy in match-date order, beside the forecasts expectation', () => {
  const picks = [
    pick(3, 'correct', 60),
    pick(1, 'incorrect', 40), // earliest match, although listed second
    pick(2, 'correct', 50),
  ];
  const trend = accuracyTrend(picks);
  assert.deepEqual(
    trend.map((t) => t.n),
    [1, 2, 3],
  );
  assert.deepEqual(
    trend.map((t) => Math.round(t.accuracy * 1000) / 1000),
    [0, 0.5, 0.667],
  );
  assert.deepEqual(
    trend.map((t) => Math.round(t.expected * 1000) / 1000),
    [0.4, 0.45, 0.5],
  );
});

test('void and pending picks are not part of the trend', () => {
  const picks = [pick(1, 'correct'), pick(2, 'void'), pick(3, null), pick(4, 'incorrect')];
  assert.equal(accuracyTrend(picks).length, 2);
  assert.deepEqual(accuracyTrend([]), []);
  assert.deepEqual(accuracyTrend(null), []);
});

const points = (results) => accuracyTrend(results.map((r, i) => pick(i + 1, r, 55)));

test('too few settled picks draw nothing', () => {
  assert.equal(trendChart(points(['correct', 'incorrect', 'correct', 'correct'])), '');
  assert.equal(trendChart([]), '');
  assert.equal(trendChart(null), '');
});

test('the chart has both lines, a text summary, and starts at the third pick', () => {
  const svg = trendChart(
    points(['correct', 'incorrect', 'correct', 'correct', 'incorrect', 'correct']),
  );
  assert.match(svg, /^<svg /);
  assert.match(svg, /role="img"/);
  assert.match(svg, /class="trend-accuracy"/);
  assert.match(svg, /class="trend-expected"/);
  // Picks 3..6 are plotted: four vertices per line.
  const vertices = (cls) =>
    svg.match(new RegExp(`class="${cls}" fill="none" points="([^"]+)"`))[1].split(' ').length;
  assert.equal(vertices('trend-accuracy'), 4);
  assert.equal(vertices('trend-expected'), 4);
  assert.match(svg, /after 3 picks/);
  assert.match(
    svg,
    /aria-label="Accuracy after each settled pick: 67% after 3 picks, 67% after 6\./,
  );
});

test('every vertex stays inside the drawing area, even for 0% and 100%', () => {
  const svg = trendChart(points(['correct', 'correct', 'correct', 'correct', 'correct']), {
    width: 600,
    height: 200,
  });
  for (const pair of svg.match(/points="([^"]+)"/g).flatMap((p) => p.slice(8, -1).split(' '))) {
    const [x, y] = pair.split(',').map(Number);
    assert.ok(x >= 0 && x <= 600 && y >= 0 && y <= 200, pair);
  }
  const worst = trendChart(
    points(['incorrect', 'incorrect', 'incorrect', 'incorrect', 'incorrect']),
  );
  assert.ok(!worst.includes('NaN') && !worst.includes('Infinity'));
});

test('the markup contains no inline styles or scripts', () => {
  const svg = trendChart(points(['correct', 'incorrect', 'correct', 'correct', 'incorrect']));
  assert.ok(!/style=|<script|on\w+=/.test(svg));
});
