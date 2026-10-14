import {iso, DAY, HOUR} from '../util.mjs';

const HISTORY_TTL = 12 * HOUR;
const HISTORY_WINDOW_DAYS = 365;
const PEEK_MAX_AGE = 3 * DAY;

/**
 * Finished matches of one team over the last year (football-data.org), cached for 12 hours.
 * `teamHistory.peek(id)` reads a cached copy without ever calling the provider.
 */
export function createHistory({provider, now}) {
  const path = (teamId) => {
    const from = iso(now() - HISTORY_WINDOW_DAYS * DAY);
    const to = iso(now());
    return `teams/${teamId}/matches?status=FINISHED&dateFrom=${from}&dateTo=${to}&limit=100`;
  };
  const teamHistory = (teamId) => provider('fd', path(teamId), HISTORY_TTL);
  teamHistory.peek = (teamId) => provider.peek('fd', path(teamId), PEEK_MAX_AGE);
  return teamHistory;
}
