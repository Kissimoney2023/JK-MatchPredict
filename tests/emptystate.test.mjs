import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../public/js/state.js';
import {emptyState, matchesInView, statusCounts} from '../public/js/views/matches.js';

const match = (home, away, status) => ({
  key: home + away,
  home,
  away,
  status,
  competition: 'League',
  kickoff: '2026-10-20T19:00:00Z',
});

const FIXTURES = [
  match('Arsenal', 'Chelsea', 'NS'),
  match('Spurs', 'Wolves', 'NS'),
  match('Leeds', 'Burnley', 'TBD'),
  match('Everton', 'Fulham', 'FT'),
];

function setState(overrides) {
  Object.assign(state, {
    connected: true,
    demo: false,
    busy: false,
    query: '',
    status: 'all',
    fixtures: FIXTURES,
    ...overrides,
  });
}

test('tab counts follow the team search', () => {
  setState();
  assert.deepEqual(statusCounts(), {all: 4, upcoming: 3, live: 0, finished: 1});
  setState({query: 'arsenal'});
  assert.deepEqual(statusCounts(), {all: 1, upcoming: 1, live: 0, finished: 0});
  assert.equal(matchesInView().length, 1);
});

test('an empty "In progress" tab says so and points at the tabs that have matches', () => {
  setState({status: 'live'});
  const html = emptyState();
  assert.match(html, /No matches are in progress right now/);
  assert.match(html, /4 matches in this date range/);
  assert.match(html, /data-status="upcoming">Show upcoming \(3\)/);
  assert.match(html, /data-status="finished">Show finished \(1\)/);
  assert.ok(!html.includes('data-status="live"'), 'no link to the tab you are already on');
});

test('the other tabs get their own wording', () => {
  setState({status: 'upcoming', fixtures: [match('A', 'B', 'FT')]});
  const html = emptyState();
  assert.match(html, /No upcoming matches in this date range/);
  assert.match(html, /Show finished \(1\)/);
  assert.ok(!html.includes('Show upcoming'));

  setState({status: 'finished', fixtures: [match('A', 'B', 'NS')]});
  assert.match(emptyState(), /No finished matches in this date range/);
});

test('a search with no hits names the search, escaped, and does not offer other tabs', () => {
  setState({query: '<b>zz</b>', status: 'upcoming'});
  const html = emptyState();
  assert.match(html, /No team matches “&lt;b&gt;zz&lt;\/b&gt;”/);
  assert.ok(!html.includes('<b>zz'));
  assert.match(html, /all 4 matches/);
});

test('loading, not connected and nothing loaded keep their own messages', () => {
  setState({busy: true});
  assert.match(emptyState(), /Loading matches/);
  setState({connected: false, fixtures: []});
  assert.match(emptyState(), /Your matchday starts here/);
  setState({fixtures: [], status: 'live'});
  assert.match(emptyState(), /No matches in this view/);
});
