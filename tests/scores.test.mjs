import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatrix,
  matrixFromMarkets,
  outcomeProbabilities,
  rateForTotalLine,
  scoreMarkets,
  HANDICAP_LINES,
} from '../server/scores.mjs';
import {ratingsForecast} from '../server/ratings.mjs';
import {goalsFromTotalLine} from '../server/model.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('a matrix is a probability distribution and its outcomes add up', () => {
  const m = buildMatrix(1.6, 1.1, -0.08);
  close(
    m.flat().reduce((s, v) => s + v, 0),
    1,
    1e-9,
    'sums to one',
  );
  const [h, d, a] = outcomeProbabilities(m);
  close(h + d + a, 1, 1e-9);
  assert.ok(h > a, 'the stronger home side is favoured');
  // A negative rho moves weight to 0-0 and 1-1.
  const plain = buildMatrix(1.6, 1.1, 0);
  assert.ok(m[0][0] > plain[0][0] && m[1][1] > plain[1][1]);
  assert.ok(m[1][0] < plain[1][0] && m[0][1] < plain[0][1]);
});

test('score markets: grid, top scores with fair odds, handicaps with pushes', () => {
  const s = scoreMarkets(buildMatrix(1.6, 1.1));
  assert.equal(s.grid.length, 7);
  assert.equal(s.grid[0].length, 7);
  close(s.grid.flat().reduce((x, v) => x + v, 0) + s.remainder, 100, 0.5, 'grid + remainder');
  assert.equal(s.top.length, 6);
  assert.ok(s.top[0].p >= s.top[1].p);
  close(s.top[0].fairOdds, 100 / s.top[0].p, 0.05, 'fair odds are 1 / p');
  assert.deepEqual(
    s.handicaps.map((h) => h.line),
    HANDICAP_LINES,
  );
  // Line 0 (draw no bet): home covers = home win, push = draw, away covers = away win.
  const [h, d, a] = outcomeProbabilities(buildMatrix(1.6, 1.1)).map(
    (v) => Math.round(v * 1000) / 10,
  );
  const zero = s.handicaps.find((x) => x.line === 0);
  close(zero.home, h, 0.11);
  close(zero.push, d, 0.11);
  close(zero.away, a, 0.11);
  close(zero.fairHome, (100 - zero.push) / zero.home, 0.02, 'push excluded from fair odds');
  // Half lines never push; -0.5 is simply the home win.
  const half = s.handicaps.find((x) => x.line === -0.5);
  assert.equal(half.push, 0);
  close(half.home, h, 0.11);
  // Giving the home side goals makes it more likely to cover.
  const covers = s.handicaps.map((x) => x.home);
  for (let i = 1; i < covers.length; i++) assert.ok(covers[i] >= covers[i - 1]);
  assert.ok(typeof s.levelLine === 'number');
});

test('the even-money rate for a total line matches the Over/Under helper', () => {
  for (const line of [2.5, 2.75, 3]) {
    const g = goalsFromTotalLine(line);
    close(rateForTotalLine(line), g.expectedTotal, 0.01, 'line ' + line);
  }
  assert.equal(rateForTotalLine(null), null);
});

test('a matrix fitted to the bookmakers reproduces their line and total', () => {
  // A known world: rates 1.7 and 1.0 with rho -0.1. Its own markets, then the fit.
  const world = buildMatrix(1.7, 1.0, -0.1);
  const p = outcomeProbabilities(world).map((v) => Math.round(v * 1000) / 10);
  const total = 2.75; // whatever line the books post; the fit shares its implied rate
  const fit = matrixFromMarkets(p, total);
  assert.ok(fit);
  close(fit.fitted[0], p[0], 0.15, 'home');
  close(fit.fitted[1], p[1], 0.15, 'draw');
  close(fit.fitted[2], p[2], 0.2, 'away');
  close(fit.rates[0] + fit.rates[1], rateForTotalLine(total), 0.02, 'total');
  assert.ok(fit.rates[0] > fit.rates[1], 'the favourite scores more');
  // The result is usable by scoreMarkets.
  const s = scoreMarkets(fit.matrix);
  assert.equal(s.grid.length, 7);
  assert.ok(s.top[0].home >= s.top[0].away);
});

test('unusable market inputs give no matrix', () => {
  assert.equal(matrixFromMarkets([48, 27, 25], null), null);
  assert.equal(matrixFromMarkets([0, 50, 50], 2.5), null);
  assert.equal(matrixFromMarkets([70, 40, 0], 2.5), null, 'home + draw must be below 100');
  assert.equal(matrixFromMarkets(null, 2.5), null);
});

test('the ratings model carries score markets that agree with its 1X2', () => {
  const rows = [];
  let id = 0;
  const day = 86_400_000;
  const now = Date.parse('2026-10-14T00:00:00Z');
  for (let i = 1; i <= 24; i++)
    for (const [h, a, hg, ag] of [
      [1, 2, 2, 0],
      [2, 1, 1, 1],
      [1, 3, 3, 1],
      [3, 2, 0, 2],
    ])
      rows.push({
        id: ++id,
        utcDate: new Date(now - i * 7 * day).toISOString(),
        status: 'FINISHED',
        homeTeam: {id: h},
        awayTeam: {id: a},
        score: {duration: 'REGULAR', fullTime: {home: hg, away: ag}},
      });
  const f = ratingsForecast({rows, homeId: 1, awayId: 2, kickoff: '2026-10-20T00:00:00Z', now});
  assert.ok(f.scores?.grid?.length === 7);
  const zero = f.scores.handicaps.find((h) => h.line === 0);
  close(zero.home, f.p[0], 0.11, 'home win = covers level line');
  close(zero.push, f.p[1], 0.11, 'draw = push');
});

test('the page block renders the grid, top scores and handicaps, escaped', async () => {
  const {scoresBlockForTest} = await import('../public/js/views/analysis.js');
  const f = {
    home: '<b>Evil</b> FC',
    away: 'Ok',
    scoresSource: 'market',
    scores: scoreMarkets(buildMatrix(1.6, 1.1)),
  };
  const html = scoresBlockForTest(f);
  assert.ok(!html.includes('<b>Evil'));
  assert.equal((html.match(/<td class="heat-/g) || []).length, 49);
  assert.match(html, /Most likely scores/);
  assert.match(html, /Asian handicap/);
  assert.match(html, /fitted to the bookmakers/);
  assert.match(html, /class="level"/);
  assert.equal(scoresBlockForTest({home: 'A', away: 'B', scores: null}), '');
});
