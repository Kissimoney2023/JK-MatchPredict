import test from 'node:test';
import assert from 'node:assert/strict';
import {organize} from '../server/service/catalog.mjs';

const league = (name, extra = {}) => ({key: 'ap:' + name, name, country: 'X', ...extra});

test('organize: featured competitions first (in order), round-style entries last', () => {
  const list = organize([
    league('Zeta Cup', {country: 'Spain'}),
    league('1st Round'),
    league('2nd Round - Group 1'),
    league('Cup Play-offs'),
    league('Premier League', {apId: 39, fdCode: 'PL', country: 'England'}),
    league('UEFA Champions League', {apId: 2, fdCode: 'CL', country: 'World'}),
    league('Alpha League', {country: 'Austria'}),
    league('Super Cup'),
    league('Friendlies'),
    league('Eredivisie', {fdCode: 'DED', country: 'Netherlands'}),
  ]);
  const names = list.map((l) => l.name);

  assert.deepEqual(names.slice(0, 3), ['UEFA Champions League', 'Premier League', 'Eredivisie']);
  assert.ok(list.slice(0, 3).every((l) => l.featured));

  const minor = list.filter((l) => l.minor).map((l) => l.name);
  assert.deepEqual(minor.sort(), [
    '1st Round',
    '2nd Round - Group 1',
    'Cup Play-offs',
    'Friendlies',
  ]);
  // Minor entries sort after every regular one.
  const firstMinor = list.findIndex((l) => l.minor);
  assert.ok(list.slice(firstMinor).every((l) => l.minor));

  // Ordinary competitions are kept (not mistaken for round-style names).
  for (const keep of ['Alpha League', 'Zeta Cup', 'Super Cup'])
    assert.equal(list.find((l) => l.name === keep).minor, false, keep);
});
