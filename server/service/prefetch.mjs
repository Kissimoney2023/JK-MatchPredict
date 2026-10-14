import {todayIso} from '../util.mjs';
import {saLeagueFor} from '../strikerapi.mjs';

const UPCOMING_WINDOW_DAYS = 30;
const DEFAULT_COMPETITIONS = 'CL';
const DEFAULT_MAX_FETCHES = 6; // leaves headroom in the 9-per-minute provider budget for users
const OPEN_STATUSES = ['NS', 'TBD'];

/**
 * Warms the caches that make forecasts cheap for users: competition fixtures, standings and
 * per-team match history. Each run is bounded by a fetch budget; reruns continue where the
 * previous one stopped, because items that are already cached cost nothing.
 *
 * Requests use exactly the parameters the app uses (today .. today+30), so the page hits the
 * same cache entries.
 */
export function createPrefetch({
  env,
  now,
  provider,
  catalog,
  fixtures,
  standings,
  history,
  strikerApi,
}) {
  const competitions = () =>
    (env.PREFETCH_COMPETITIONS || DEFAULT_COMPETITIONS)
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);

  async function run({maxFetches = DEFAULT_MAX_FETCHES} = {}) {
    const startFetches = provider.stats.fetches;
    const spent = () => provider.stats.fetches - startFetches;
    const summary = {competitions: [], fetches: 0, budgetReached: false, errors: []};

    /** Runs `fn` unless the fetch budget is used up. Failures are recorded, not thrown. */
    async function step(label, fn) {
      if (spent() >= maxFetches) {
        summary.budgetReached = true;
        return null;
      }
      try {
        return await fn();
      } catch (e) {
        summary.errors.push(`${label}: ${e.message}`);
        return null;
      }
    }

    for (const code of competitions()) {
      const entry = {code, fixtures: 0, standings: false, teamsWarmed: 0, teamsRemaining: 0};
      summary.competitions.push(entry);

      const selected = await step(`${code} catalog`, async () => {
        const found = (await catalog()).leagues.find((l) => l.fdCode === code);
        if (!found) throw new Error('competition not in the provider catalog');
        return found;
      });
      if (!selected) continue;

      const list = await step(`${code} fixtures`, () =>
        fixtures(
          new URLSearchParams({
            league: selected.key,
            from: todayIso(0, now()),
            to: todayIso(UPCOMING_WINDOW_DAYS, now()),
          }),
        ),
      );
      entry.fixtures = list?.fixtures.length ?? 0;

      entry.standings = !!(await step(`${code} standings`, () => standings(selected.key)));

      // StrikerAPI (when configured): the market schedule and Elo ratings, cached for hours.
      const saLeague = saLeagueFor(code);
      if (strikerApi.enabled() && saLeague) {
        await step(`${code} StrikerAPI schedule`, () => strikerApi.schedule(saLeague));
        await step(`${code} StrikerAPI ratings`, () => strikerApi.ratings(saLeague));
      }

      const teamIds = new Set();
      for (const f of list?.fixtures ?? []) {
        if (!OPEN_STATUSES.includes(f.status)) continue;
        if (Number.isInteger(f.homeTeamId)) teamIds.add(f.homeTeamId);
        if (Number.isInteger(f.awayTeamId)) teamIds.add(f.awayTeamId);
      }
      const queue = [...teamIds];
      for (const [i, id] of queue.entries()) {
        if (spent() >= maxFetches) {
          summary.budgetReached = true;
          entry.teamsRemaining = queue.length - i;
          break;
        }
        const ok = await step(`${code} team ${id}`, () => history(id));
        if (ok) entry.teamsWarmed++;
      }
    }

    summary.fetches = spent();
    return summary;
  }

  return {run};
}
