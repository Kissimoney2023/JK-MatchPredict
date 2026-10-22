import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedValue,
  impliedProbability,
  kellyStake,
  parseOdds,
  slipSummary,
  valueCheck,
} from '../server/value.mjs';

test('prices in decimal, fractional and American forms all parse to decimal odds', () => {
  assert.equal(parseOdds('2.25'), 2.25);
  assert.equal(parseOdds(' 2,25 '), 2.25);
  assert.equal(parseOdds('5/4'), 2.25);
  assert.equal(parseOdds('1/2'), 1.5);
  assert.equal(parseOdds('+125'), 2.25);
  assert.equal(parseOdds('-110'), 1.909);
  assert.equal(parseOdds('1.00'), null, 'decimal odds must exceed 1');
  assert.equal(parseOdds('0.8'), null);
  assert.equal(parseOdds('abc'), null);
  assert.equal(parseOdds(''), null);
  assert.equal(parseOdds('5/0'), null);
  assert.equal(parseOdds('+50'), null, 'an American price needs three digits');
});

test('implied probability, expected value and Kelly behave', () => {
  assert.equal(impliedProbability(2), 0.5);
  assert.equal(Math.round(expectedValue(0.5, 2.2) * 1000) / 1000, 0.1);
  assert.equal(expectedValue(0.5, 2), 0);
  assert.equal(kellyStake(0.5, 2), 0, 'no edge, no stake');
  assert.equal(kellyStake(0.4, 2.2), 0, 'negative edge, no stake');
  // Full Kelly at p=0.6, odds 2.0 is 0.2; quarter is 0.05, capped at 0.02.
  assert.equal(kellyStake(0.6, 2), 0.02);
  // A small edge stays under the cap: p=0.52, odds 2.0 -> full 0.04, quarter 0.01.
  assert.equal(Math.round(kellyStake(0.52, 2) * 10000) / 10000, 0.01);
  assert.equal(kellyStake(0.52, 2, {cap: 0.005}), 0.005);
  assert.equal(kellyStake(1, 2), 0, 'certainties are not a thing');
});

test('a value check says value only when the price beats fair odds', () => {
  const value = valueCheck(48.2, 2.3, {bankroll: 200});
  assert.equal(value.value, true);
  assert.equal(value.fairOdds, 2.07);
  assert.ok(value.expectedValuePercent > 10 && value.expectedValuePercent < 11.5);
  assert.ok(value.stake > 0 && value.stake <= 4, 'capped at 2% of 200');
  assert.equal(value.edge, 4.7);

  const none = valueCheck(48.2, 1.95);
  assert.equal(none.value, false);
  assert.ok(none.expectedValuePercent < 0);
  assert.equal(none.stake, 0);

  assert.equal(valueCheck(0, 2), null);
  assert.equal(valueCheck(50, 1), null);
  assert.equal(valueCheck('x', 2), null);
});

test('a slip multiplies independent legs; nine Champions League favourites are a long shot', () => {
  // Roughly the probabilities behind a 9-leg slip at 2.40, 2.25, 1.22, 1.24, 2.15, 1.83, 1.25, 1.25, 1.60.
  const legs = [40, 42, 78, 77, 44, 52, 76, 76, 60];
  const s = slipSummary(legs);
  assert.equal(s.legs, 9);
  assert.ok(s.probabilityPercent > 0.5 && s.probabilityPercent < 2, String(s.probabilityPercent));
  assert.ok(s.oneIn > 50 && s.oneIn < 200, String(s.oneIn));
  assert.ok(s.fairOdds > 40);

  const priced = slipSummary(legs, 80.35);
  assert.equal(priced.combinedOdds, 80.35);
  assert.equal(typeof priced.expectedValuePercent, 'number');
  assert.equal(priced.value, priced.expectedValuePercent > 0);

  const single = slipSummary([50], 2.5);
  assert.equal(single.probabilityPercent, 50);
  assert.equal(single.fairOdds, 2);
  assert.equal(single.oneIn, 2);
  assert.equal(single.expectedValuePercent, 25);
});

test('legs without a usable chance are left out and counted', () => {
  const s = slipSummary([50, NaN, 0, 60, 120]);
  assert.equal(s.legs, 2);
  assert.equal(s.skipped, 3);
  assert.equal(s.probabilityPercent, 30);
  assert.deepEqual(slipSummary([]), {legs: 0, skipped: 0, probability: null});
  assert.deepEqual(slipSummary([NaN]), {legs: 0, skipped: 1, probability: null});
});

test('the page helpers render safely', async () => {
  const {valueBlockHtml, verdictHtml, selectionsOf} = await import('../public/js/views/value.js');
  const f = {
    home: '<b>Evil</b>',
    away: 'B',
    p: [48.2, 26.5, 25.3],
    modelVersion: 'market-shin-v1',
    goals: {lines: [{line: 2.5, over: 52.4, under: 47.6}]},
  };
  assert.equal(selectionsOf(f).length, 5);
  const html = valueBlockHtml(f);
  assert.ok(!html.includes('<b>Evil'), 'team names are escaped');
  assert.match(html, /Over 2\.5 goals · 52\.4% · fair 1\.91/);
  const yes = verdictHtml(valueCheck(48.2, 2.3), {marketLed: true});
  assert.match(yes, /Value by this forecast/);
  assert.match(yes, /genuine difference between bookmakers/);
  const no = verdictHtml(valueCheck(48.2, 1.9), {marketLed: false});
  assert.match(no, /No value/);
  assert.match(no, /Treat small edges as noise/);
  assert.match(no, /Suggested stake: <strong>nothing/);
  assert.equal(verdictHtml(null), '');

  const {slipHtml} = await import('../public/js/views/slip.js');
  const pick = (home, outcome, p) => ({
    id: home,
    outcome,
    forecast: {home, away: 'X', p: [p, 100 - p - 10, 10], kickoff: '2099-01-01T00:00:00Z'},
  });
  const slip = slipHtml([pick('<img src=x>', 0, 60), pick('B', 0, 50)], '3,5');
  assert.ok(!slip.includes('<img src=x'));
  assert.match(slip, /All 2 legs win/);
  assert.match(slip, /30%/);
  assert.match(slip, /about 1 in 3/);
  assert.match(slip, /price 3\.50/);
  assert.match(slip, /\+5%/, '0.3 × 3.5 = 1.05');
  assert.equal(slipHtml([], ''), '');
});
