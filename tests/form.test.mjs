import test from 'node:test';
import assert from 'node:assert/strict';
import {finishedMatches, headToHead, recentForm} from '../server/form.mjs';

const NOW = Date.parse('2026-10-14T00:00:00Z');
const DAY = 86_400_000;

let nextId = 1;
const match = (daysAgo, home, away, hg, ag, extra = {}) => ({
  id: nextId++,
  utcDate: new Date(NOW - daysAgo * DAY).toISOString(),
  status: 'FINISHED',
  homeTeam: {id: home, name: `Team ${home} FC`, shortName: `T${home}`},
  awayTeam: {id: away, name: `Team ${away} FC`, shortName: `T${away}`},
  score: {duration: 'REGULAR', fullTime: {home: hg, away: ag}},
  ...extra,
});

test('recentForm: newest first, venue-aware W/D/L, limited to n', () => {
  const rows = [
    match(1, 1, 2, 3, 0), // home win vs T2
    match(3, 3, 1, 1, 1), // away draw at T3
    match(5, 1, 4, 0, 2), // home loss vs T4
    match(7, 5, 1, 0, 1), // away win at T5
    match(9, 1, 6, 2, 1),
    match(11, 1, 7, 2, 1), // sixth game: excluded by n=5
    match(2, 8, 9, 5, 5), // someone else's match
  ];
  const form = recentForm(rows, 1, NOW, 5);
  assert.deepEqual(
    form.games.map((g) => g.result),
    ['W', 'D', 'L', 'W', 'W'],
  );
  assert.deepEqual(form.record, {w: 3, d: 1, l: 1});
  assert.equal(form.games[0].venue, 'H');
  assert.equal(form.games[0].opponent, 'T2');
  assert.equal(form.games[1].venue, 'A');
  assert.equal(form.games[1].score, '1–1');
});

test('finishedMatches skips extra-time, unfinished, duplicate and future matches', () => {
  const ok = match(1, 1, 2, 1, 0);
  const rows = [
    ok,
    {...ok}, // duplicate id
    match(2, 1, 2, 2, 2, {score: {duration: 'EXTRA_TIME', fullTime: {home: 3, away: 2}}}),
    match(3, 1, 2, 0, 0, {status: 'TIMED'}),
    match(-2, 1, 2, 1, 1), // future
  ];
  assert.equal(finishedMatches(rows, NOW).length, 1);
});

test('headToHead tallies from the first team’s point of view, regardless of venue', () => {
  const rows = [
    match(10, 1, 2, 2, 0), // T1 win at home
    match(100, 2, 1, 1, 1), // draw
    match(200, 2, 1, 3, 1), // T2 win at home
    match(5, 1, 3, 4, 0), // unrelated pairing
  ];
  const h2h = headToHead(rows, 1, 2, NOW);
  assert.deepEqual([h2h.winsA, h2h.draws, h2h.winsB], [1, 1, 1]);
  assert.equal(h2h.matches.length, 3);
  assert.equal(h2h.matches[0].score, '2–0'); // newest first
  assert.deepEqual(headToHead(rows, 1, 9, NOW).matches, []);
});
