import test from 'node:test';
import assert from 'node:assert/strict';
import {otherMatches, otherMatchesTitle} from '../public/js/othermatches.js';

const HOUR = 3_600_000;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const t0 = Date.now() + 48 * HOUR; // far enough ahead that every match below is still open
const dayStart = t0 - (t0 % (24 * HOUR)); // 00:00 UTC of that day

const match = (key, competition, hoursIntoDay, status = 'NS') => ({
  key,
  competition,
  home: 'H' + key,
  away: 'A' + key,
  status,
  kickoff: new Date(dayStart + hoursIntoDay * HOUR).toISOString(),
});

const current = match('cur', 'Premier League', 15);
const options = {dayOf: utcDay};

test('only open matches from the same day are listed, never the current one', () => {
  const list = [
    current,
    match('a', 'Premier League', 12),
    match('next-day', 'Premier League', 26),
    match('earlier-day', 'Premier League', -3),
    match('done', 'Premier League', 11, 'FT'),
    match('live', 'Premier League', 10, '1H'),
    match('postponed', 'Premier League', 9, 'PST'),
  ];
  assert.deepEqual(
    otherMatches(list, current, options).map((m) => m.key),
    ['a'],
  );
});

test('the same competition comes first, then by kickoff', () => {
  const list = [
    match('cl-early', 'Champions League', 8),
    match('pl-late', 'Premier League', 20),
    match('cl-late', 'Champions League', 21),
    match('pl-early', 'Premier League', 11),
  ];
  assert.deepEqual(
    otherMatches(list, current, options).map((m) => m.key),
    ['pl-early', 'pl-late', 'cl-early', 'cl-late'],
  );
});

test('the list is capped, and empty when there is nothing else that day', () => {
  const many = Array.from({length: 12}, (_, i) => match('m' + i, 'Premier League', i));
  assert.equal(otherMatches(many, current, options).length, 6);
  assert.equal(otherMatches(many, current, {...options, limit: 3}).length, 3);
  assert.deepEqual(otherMatches([current], current, options), []);
  assert.deepEqual(otherMatches([], current, options), []);
});

test('the heading says "Today" only for matches today', () => {
  const now = dayStart + 5 * HOUR;
  assert.equal(otherMatchesTitle(current, {dayOf: utcDay, now}), 'Today’s other matches');
  assert.equal(
    otherMatchesTitle(current, {dayOf: utcDay, now: now - 3 * 24 * HOUR}),
    'Other matches that day',
  );
});
