import test from 'node:test';
import assert from 'node:assert/strict';
import {goalRates, teamStats} from '../server/form.mjs';
import {analyze, goalMarkets} from '../server/analysis.mjs';

const NOW = Date.parse('2026-10-14T10:00:00Z');
const DAY = 86_400_000;
let id = 0;

/** A finished regulation-time match `daysAgo` days before NOW. */
const match = (daysAgo, home, away, hg, ag) => ({
  id: ++id,
  utcDate: new Date(NOW - daysAgo * DAY).toISOString(),
  status: 'FINISHED',
  homeTeam: {id: home, name: 'T' + home},
  awayTeam: {id: away, name: 'T' + away},
  score: {duration: 'REGULAR', fullTime: {home: hg, away: ag}},
});

// Team 1: W 2-0 (home), D 1-1 (away), L 0-3 (home), W 3-1 (away)
const rows = [
  match(1, 1, 2, 2, 0),
  match(2, 3, 1, 1, 1),
  match(3, 1, 4, 0, 3),
  match(4, 5, 1, 1, 3),
];

test('team stats cover points, goals, clean sheets and goal trends', () => {
  const s = teamStats(rows, 1, NOW);
  assert.equal(s.played, 4);
  assert.deepEqual([s.wins, s.draws, s.losses], [2, 1, 1]);
  assert.equal(s.ppg, 1.75); // (2*3 + 1) / 4
  assert.equal(s.winRate, 0.5);
  assert.equal(s.scored, 1.5); // 2+1+0+3
  assert.equal(s.conceded, 1.25); // 0+1+3+1
  assert.equal(s.cleanSheetRate, 0.25);
  assert.equal(s.failedToScoreRate, 0.25);
  assert.equal(s.bttsRate, 0.5); // 1-1 and 3-1
  assert.equal(s.over25Rate, 0.5); // 0-3 and 1-3 only
});

test('home and away splits only use that venue; the sample size is limited', () => {
  const home = teamStats(rows, 1, NOW, {venue: 'home'});
  assert.equal(home.played, 2);
  assert.equal(home.scored, 1);
  const away = teamStats(rows, 1, NOW, {venue: 'away'});
  assert.equal(away.played, 2);
  assert.equal(away.scored, 2);

  const many = Array.from({length: 15}, (_, i) => match(i + 1, 1, 2, 1, 0));
  assert.equal(teamStats(many, 1, NOW).played, 10);
  assert.equal(teamStats(many, 1, NOW, {n: 3}).played, 3);
});

test('no matches means no stats, and unplayed or extra-time matches are ignored', () => {
  assert.equal(teamStats([], 1, NOW), null);
  assert.equal(teamStats(rows, 99, NOW), null);
  const odd = [
    {...match(1, 1, 2, 1, 0), status: 'SCHEDULED'},
    {...match(2, 1, 2, 1, 0), score: {duration: 'EXTRA_TIME', fullTime: {home: 2, away: 1}}},
    match(-3, 1, 2, 5, 0), // in the future
  ];
  assert.equal(teamStats(odd, 1, NOW), null);
});

test('observed goal rates pool both teams and count a shared meeting once', () => {
  const shared = match(2, 1, 2, 2, 2); // a meeting of both teams
  const a = [shared, match(5, 1, 3, 1, 0)];
  const b = [shared, match(6, 4, 2, 0, 0)];
  const rates = goalRates(a, 1, b, 2, NOW);
  assert.equal(rates.matches, 3);
  const line = (l) => rates.lines.find((x) => x.line === l);
  assert.equal(line(0.5).over, 0.667); // 2-2 and 1-0 have goals; 0-0 does not
  assert.equal(line(0.5).under, 0.333);
  assert.equal(line(2.5).over, 0.333); // only 2-2 has more than two
  assert.equal(rates.btts, 0.333);
  assert.equal(goalRates([], 1, [], 2, NOW), null);
});

test('goal markets: probabilities are consistent and match the existing tips', () => {
  const g = goalMarkets([1.6, 1.1]);
  assert.deepEqual(
    g.lines.map((l) => l.line),
    [0.5, 1.5, 2.5, 3.5],
  );
  for (const l of g.lines) assert.ok(Math.abs(l.over + l.under - 100) < 0.11, String(l.line));
  for (let i = 1; i < g.lines.length; i++)
    assert.ok(g.lines[i].over < g.lines[i - 1].over, 'a higher line is less likely to be beaten');
  // Over 0.5 is "not 0-0": 1 - e^-(2.7)
  assert.equal(g.lines[0].over, Math.round((1 - Math.exp(-2.7)) * 1000) / 10);
  // Over 2.5 agrees with the 'Total goals' tip derived the long way.
  const tip = analyze({
    home: 'A',
    away: 'B',
    p: [45, 28, 27],
    expectedGoals: [1.6, 1.1],
  }).tips.find((t) => t.market.startsWith('Total goals'));
  const overTwoAndHalf = g.lines[2].over;
  assert.equal(tip.probability, Math.max(overTwoAndHalf, g.lines[2].under));
  // Both teams to score matches the tip too.
  const btts = analyze({
    home: 'A',
    away: 'B',
    p: [45, 28, 27],
    expectedGoals: [1.6, 1.1],
  }).tips.find((t) => t.market.startsWith('Both teams'));
  assert.equal(btts.probability, Math.max(g.btts, Math.round((100 - g.btts) * 10) / 10));
});

test('analysis carries goal markets only when the model produced expected goals', () => {
  assert.equal(analyze({home: 'A', away: 'B', p: [40, 30, 30]}).goals, null);
  assert.equal(
    analyze({home: 'A', away: 'B', p: [40, 30, 30], expectedGoals: [1.2, 1.0]}).goals.lines.length,
    4,
  );
});
