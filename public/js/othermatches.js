import {isOpen} from './state.js';

const MAX_SHOWN = 6;
const localDay = (ms) => new Date(ms).toDateString();

/**
 * Other matches worth a look from the same day as `current`, taken from the list the person is
 * already browsing (no extra requests). Only matches that still accept picks; the same
 * competition first, then by kickoff. `dayOf` decides what "the same day" means (local by
 * default, matching the times shown on the page).
 */
export function otherMatches(fixtures, current, {dayOf = localDay, limit = MAX_SHOWN} = {}) {
  const day = dayOf(Date.parse(current.kickoff));
  return fixtures
    .filter((f) => f.key !== current.key && isOpen(f) && dayOf(Date.parse(f.kickoff)) === day)
    .sort(
      (a, b) =>
        (a.competition === current.competition ? 0 : 1) -
          (b.competition === current.competition ? 0 : 1) ||
        Date.parse(a.kickoff) - Date.parse(b.kickoff),
    )
    .slice(0, limit);
}

/** The heading for that list: "Today's other matches" when the match is today. */
export function otherMatchesTitle(current, {dayOf = localDay, now = Date.now()} = {}) {
  return dayOf(Date.parse(current.kickoff)) === dayOf(now)
    ? 'Today’s other matches'
    : 'Other matches that day';
}
