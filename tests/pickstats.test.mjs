import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePicks, wilson} from '../server/pickstats.mjs';

let day = 0;
const pick = (outcome, p, result, competition = 'UEFA Champions League') => ({
  outcome,
  result,
  createdAt: 1_000,
  forecast: {
    p,
    competition,
    home: 'A',
    away: 'B',
    kickoff: new Date(Date.UTC(2026, 9, ++day)).toISOString(),
  },
});

/** Seven picks with hand-computed expectations (see the assertions). */
const sample = () => {
  day = 0;
  return [
    pick(0, [60, 25, 15], 'correct'), // CL, picked the favourite, 60%
    pick(0, [50, 30, 20], 'incorrect'), // CL, favourite, 50%
    pick(2, [20, 30, 50], 'correct', 'Premier League'), // PL, favourite, 50%
    pick(1, [30, 40, 30], 'correct', 'Premier League'), // PL, favourite (draw), 40%
    pick(2, [45, 30, 25], 'incorrect'), // CL, against the favourite, 25%
    pick(0, [50, 25, 25], 'void'),
    pick(1, [30, 40, 30], null), // pending
  ];
};

test('wilson interval is honest about small samples', () => {
  const half = wilson(5, 10);
  assert.equal(half.rate, 0.5);
  assert.ok(Math.abs(half.low - 0.2366) < 0.001 && Math.abs(half.high - 0.7634) < 0.001);
  assert.equal(wilson(0, 0), null);
  const perfect = wilson(10, 10);
  assert.equal(perfect.high, 1);
  assert.ok(perfect.low > 0.72 && perfect.low < 0.73, 'ten from ten is not "certain"');
  // More data narrows the range.
  assert.ok(wilson(50, 100).high - wilson(50, 100).low < half.high - half.low);
});

test('totals: void and pending picks never count towards accuracy', () => {
  const s = summarizePicks(sample());
  assert.equal(s.total, 7);
  assert.equal(s.settled, 5);
  assert.equal(s.correct, 3);
  assert.equal(s.incorrect, 2);
  assert.equal(s.voided, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.accuracy.rate, 0.6);
  assert.ok(s.accuracy.low < 0.6 && s.accuracy.high > 0.6);
  assert.equal(s.smallSample, true);
});

test('streaks and recent results follow match dates, newest first', () => {
  const s = summarizePicks(sample());
  // Match order: correct, incorrect, correct, correct, incorrect.
  assert.deepEqual(s.currentStreak, {type: 'incorrect', length: 1});
  assert.equal(s.bestWinStreak, 2);
  assert.deepEqual(s.recent, ['incorrect', 'correct', 'correct', 'incorrect', 'correct']);

  // Input order must not matter.
  const shuffled = summarizePicks([...sample()].reverse());
  assert.deepEqual(shuffled.recent, s.recent);
  assert.deepEqual(shuffled.currentStreak, s.currentStreak);

  day = 0;
  const streak = summarizePicks([
    pick(0, [50, 30, 20], 'incorrect'),
    pick(0, [50, 30, 20], 'correct'),
    pick(0, [50, 30, 20], 'correct'),
    pick(0, [50, 30, 20], 'correct'),
  ]);
  assert.deepEqual(streak.currentStreak, {type: 'correct', length: 3});
});

test('breakdowns by pick, competition and confidence', () => {
  const s = summarizePicks(sample());

  const byOutcome = Object.fromEntries(s.byOutcome.map((o) => [o.label, o]));
  assert.equal(byOutcome['Home win'].picks, 3, 'pending and void picks still count as picks');
  assert.equal(byOutcome['Home win'].settled, 2);
  assert.equal(byOutcome['Home win'].accuracy, 0.5);
  assert.equal(byOutcome['Draw'].settled, 1);
  assert.equal(byOutcome['Draw'].accuracy, 1);
  assert.equal(byOutcome['Away win'].accuracy, 0.5);

  assert.deepEqual(
    s.byCompetition.map((c) => [c.name, c.settled, c.correct]),
    [
      ['UEFA Champions League', 3, 1],
      ['Premier League', 2, 2],
    ],
  );

  const bands = Object.fromEntries(s.byConfidence.map((b) => [b.range, b]));
  assert.deepEqual(Object.keys(bands), ['Under 40%', '40–50%', '50–60%', '60% and over']);
  assert.equal(bands['Under 40%'].settled, 1);
  assert.equal(bands['Under 40%'].accuracy, 0);
  assert.ok(Math.abs(bands['Under 40%'].averagePredicted - 0.25) < 1e-9);
  assert.equal(bands['50–60%'].settled, 2);
  assert.equal(bands['50–60%'].correct, 1);
  assert.equal(bands['60% and over'].accuracy, 1);
});

test('following versus going against the model favourite, and expected wins', () => {
  const s = summarizePicks(sample());
  assert.deepEqual(s.followedModel.following, {settled: 4, accuracy: 0.75});
  assert.deepEqual(s.followedModel.against, {settled: 1, accuracy: 0});
  // Probabilities on the picked outcomes: .6 + .5 + .5 + .4 + .25 = 2.25 expected correct.
  assert.ok(s.expectedCorrect >= 2.2 && s.expectedCorrect <= 2.3);
  assert.equal(s.correct, 3);
});

test('no picks, and picks without forecast data, are handled', () => {
  const empty = summarizePicks([]);
  assert.equal(empty.settled, 0);
  assert.equal(empty.accuracy, null);
  assert.equal(empty.currentStreak, null);
  assert.deepEqual(empty.recent, []);
  assert.deepEqual(empty.byConfidence, []);
  assert.equal(summarizePicks(undefined).total, 0);

  const odd = summarizePicks([{outcome: 0, result: 'correct', createdAt: 5}]);
  assert.equal(odd.settled, 1);
  assert.equal(odd.correct, 1);
  assert.deepEqual(odd.byConfidence, []);
  assert.deepEqual(odd.byCompetition, []);
});

test('twenty settled picks is no longer flagged as a small sample', () => {
  day = 0;
  const many = Array.from({length: 20}, () => pick(0, [50, 30, 20], 'correct'));
  const s = summarizePicks(many);
  assert.equal(s.smallSample, false);
  assert.equal(s.bestWinStreak, 20);
});
