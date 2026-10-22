import {AppError} from '../errors.mjs';
import {dates, hash, iso, DAY} from '../util.mjs';
import {normAP, normFD} from './normalize.mjs';

const FIXTURES_TTL = 30 * 60_000;

const staleNote = (at) =>
  `Showing saved data from ${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC; the provider is temporarily unavailable.`;

export function createFixtures({env, store, provider, league, strikerApi}) {
  async function fixtureResult(items, data, source, warnings) {
    items.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
    const listingId = hash(JSON.stringify([source, data.at, items.map((f) => f.key)]));
    await store.setJSON('listing/' + listingId, {items, at: data.at});
    return {fixtures: items, listingId, source, fetchedAt: data.at, warnings};
  }

  /** Lists fixtures from API-Football, falling back to football-data.org. */
  async function fixtures(params) {
    const {from, to} = dates(params);
    const selected = await league(params.get('league'));
    const errors = [];

    // A StrikerAPI-only competition: its schedule and games are the whole source.
    if (selected?.saOnly) {
      const competition = strikerApi
        .onlyCompetitions()
        .find((c) => 'sa:' + c.league === selected.key);
      if (!competition)
        throw new AppError(503, 'unavailable', 'This competition needs StrikerAPI configured.');
      const data = await strikerApi.fixturesFor(competition, from, to);
      if (data.stale) errors.push(staleNote(data.at));
      errors.push(
        'Fixtures and results come from StrikerAPI; forecasts for this competition use the bookmakers’ consensus only, so a match without a line yet has no forecast.',
      );
      return await fixtureResult(data.items, {at: data.at}, 'StrikerAPI', errors);
    }

    if (env.API_FOOTBALL_KEY && (!selected || selected.apId)) {
      try {
        if (!selected && from !== to)
          throw new AppError(
            400,
            'all_dates',
            'All-league browsing uses one date at a time. Choose a league for a date range.',
          );
        const path = selected
          ? `fixtures?league=${selected.apId}&season=${selected.season}&from=${from}&to=${to}`
          : `fixtures?date=${from}`;
        const data = await provider('ap', path, FIXTURES_TTL);
        const items = (data.body.response ?? []).map(normAP).filter(Boolean);
        if (data.stale) errors.push(staleNote(data.at));
        if (items.length || !env.FOOTBALL_DATA_ORG_KEY)
          return await fixtureResult(items, data, 'API-Football', errors);
      } catch (e) {
        if (e.code === 'all_dates') throw e;
        errors.push(e.message);
      }
    }

    if (env.FOOTBALL_DATA_ORG_KEY && (!selected || selected.fdCode)) {
      const range = `dateFrom=${from}&dateTo=${iso(Date.parse(to) + DAY)}`;
      const path = selected
        ? `competitions/${selected.fdCode}/matches?${range}`
        : `matches?${range}`;
      const data = await provider('fd', path, FIXTURES_TTL);
      const items = (data.body.matches ?? [])
        .map(normFD)
        .filter(
          (f) =>
            f &&
            Date.parse(f.kickoff) >= Date.parse(from) &&
            Date.parse(f.kickoff) < Date.parse(to) + DAY,
        );
      if (data.stale) errors.push(staleNote(data.at));
      errors.push(
        'Fallback data may be delayed. Forecasts use an experimental model, subject to sufficient match history.',
      );
      return await fixtureResult(items, data, 'football-data.org', errors);
    }

    throw new AppError(
      503,
      'unavailable',
      errors.join(' ') ||
        'No connected provider covers this league. Configure an API key or choose another league.',
    );
  }

  return {fixtures};
}
