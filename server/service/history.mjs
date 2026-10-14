import {iso, DAY, HOUR} from '../util.mjs';

const HISTORY_TTL = 12 * HOUR;
const HISTORY_WINDOW_DAYS = 365;

/** Finished matches of one team over the last year (football-data.org), cached for 12 hours. */
export function createHistory({provider, now}) {
  return function teamHistory(teamId) {
    const from = iso(now() - HISTORY_WINDOW_DAYS * DAY);
    const to = iso(now());
    return provider(
      'fd',
      `teams/${teamId}/matches?status=FINISHED&dateFrom=${from}&dateTo=${to}&limit=100`,
      HISTORY_TTL,
    );
  };
}
