import {AppError} from '../errors.mjs';
import {goalRates, headToHead, recentForm, teamStats} from '../form.mjs';
import {sameTeam} from '../strikerapi.mjs';
import {matchKey} from '../model.mjs';

const FORM_GAMES = 5;
const teamIdsOf = (items) => [
  ...new Set(
    items.flatMap((f) => [f.homeTeamId, f.awayTeamId]).filter((id) => Number.isInteger(id)),
  ),
];

/** Team form and head-to-head, derived from the cached football-data.org histories. */
export function createInsights({
  env,
  now,
  storage,
  history,
  lookup,
  strikerApi,
  standings,
  lineups,
}) {
  const {read} = storage;

  /**
   * Adds `form` ({home, away}: arrays of 'W'|'D'|'L', newest first) to fixtures whose team
   * histories are already cached. Reads the cache only; never calls a provider.
   */
  async function withForm(items) {
    if (!env.FOOTBALL_DATA_ORG_KEY) return items;
    const rowsById = new Map();
    await Promise.all(
      teamIdsOf(items).map(async (id) => {
        const cached = await history.peek(id);
        if (cached) rowsById.set(id, cached.body.matches ?? []);
      }),
    );
    const formOf = (id) =>
      rowsById.has(id)
        ? recentForm(rowsById.get(id), id, now(), FORM_GAMES).games.map((g) => g.result)
        : null;
    return items.map((f) => {
      const home = formOf(f.homeTeamId);
      const away = formOf(f.awayTeamId);
      return home || away ? {...f, form: {home, away}} : f;
    });
  }

  /**
   * Where each team stands in the competition table (from the cached standings), or null when
   * there is no table or neither club can be found in it unambiguously. Never throws: a
   * missing position must not hide the rest of the insights.
   */
  async function leaguePosition(known) {
    try {
      if (!standings || !known.leagueKey) return null;
      const table = await standings(known.leagueKey);
      const find = (name) => {
        const hits = [];
        for (const group of table.groups)
          for (const r of group.table)
            if (sameTeam(r.team, name)) hits.push({r, size: group.table.length, group: group.name});
        if (hits.length !== 1) return null; // absent, or ambiguous: say nothing rather than guess
        const {r, size, group} = hits[0];
        return {
          position: r.position,
          of: size,
          group,
          played: r.played,
          won: r.won,
          drawn: r.drawn,
          lost: r.lost,
          points: r.points,
          goalDifference: r.goalDifference,
        };
      };
      const home = find(known.home);
      const away = find(known.away);
      if (!home && !away) return null;
      return {
        competition: table.competition,
        season: table.season,
        source: table.source,
        fetchedAt: table.fetchedAt,
        stale: !!table.stale,
        home,
        away,
      };
    } catch {
      return null;
    }
  }

  /** Recent form and last-12-months meetings from football-data.org histories (may fetch two). */
  async function formInsights(known) {
    let target = known;
    if (!Number.isInteger(known.homeTeamId)) {
      try {
        target = (await lookup.mappedFD(known)).f;
      } catch {
        throw new AppError(404, 'insights', 'Form is not available for this match.');
      }
    }
    const h = await history(target.homeTeamId);
    const a = await history(target.awayTeamId);
    const homeRows = h.body.matches ?? [];
    const awayRows = a.body.matches ?? [];
    const rows = [...homeRows, ...awayRows];
    const side = (teamRows, id, venue) => ({
      overall: teamStats(teamRows, id, now()),
      venue: teamStats(teamRows, id, now(), {venue}),
    });
    return {
      stats: {
        home: side(homeRows, target.homeTeamId, 'home'),
        away: side(awayRows, target.awayTeamId, 'away'),
        goals: goalRates(homeRows, target.homeTeamId, awayRows, target.awayTeamId, now()),
      },
      home: {name: known.home, ...recentForm(h.body.matches ?? [], target.homeTeamId, now())},
      away: {name: known.away, ...recentForm(a.body.matches ?? [], target.awayTeamId, now())},
      headToHead: headToHead(rows, target.homeTeamId, target.awayTeamId, now()),
      headToHeadNote: 'Meetings in the last 12 months only.',
      fetchedAt: Math.min(h.at, a.at),
      stale: !!(h.stale || a.stale),
    };
  }

  /**
   * Detailed insights for one listed match: recent form and 12-month meetings
   * (football-data.org), plus, when StrikerAPI is configured, all-time competition
   * head-to-head, competition Elo ratings and the market line. Each part is optional.
   */
  async function insights(key, listingId) {
    if (!env.FOOTBALL_DATA_ORG_KEY && !strikerApi.enabled())
      throw new AppError(503, 'not_configured', 'No insights data source is configured.');
    if (!/^[a-f0-9]{64}$/.test(listingId || ''))
      throw new AppError(400, 'listing', 'Refresh the match browser first.');
    const listing = await read('listing/' + listingId);
    const known = listing?.items?.find((f) => f.key === key);
    if (!known) throw new AppError(404, 'fixture', 'Load this match from the match browser first.');

    const [form, market, elo, competitionHeadToHead, position, xg, teamSheets] = await Promise.all([
      env.FOOTBALL_DATA_ORG_KEY
        ? formInsights(known).then(
            (value) => value,
            (error) => ({error}),
          )
        : null,
      strikerApi.marketFor(known),
      strikerApi.eloFor(known),
      strikerApi.headToHeadFor(known),
      leaguePosition(known),
      strikerApi.xgFor ? strikerApi.xgFor(known) : null,
      lineups ? lineups.get(matchKey(known)).catch(() => null) : null,
    ]);
    const formResult = form?.error ? null : form;
    const extras = {
      market,
      elo,
      competitionHeadToHead,
      leaguePosition: position,
      xg,
      lineups: teamSheets,
    };
    // Nothing at all to show: surface the form error instead of an empty panel.
    if (!formResult && !market && !elo && !competitionHeadToHead && !position && !xg && !teamSheets)
      throw (
        form?.error ?? new AppError(404, 'insights', 'No insights are available for this match.')
      );
    return {home: null, away: null, headToHead: null, ...formResult, ...extras};
  }

  return {withForm, insights};
}
