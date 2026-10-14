import {createHash} from 'node:crypto';
import {AppError} from './errors.mjs';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const hash = (s) => createHash('sha256').update(String(s)).digest('hex');
export const iso = (n) => new Date(n).toISOString().slice(0, 10);

const isValidDate = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && iso(Date.parse(s)) === s;

/** Parses and validates the `from`/`to` query parameters (UTC dates, max 31 days). */
export function dates(params) {
  const from = params.get('from') || iso(Date.now());
  const to = params.get('to') || from;
  if (
    !isValidDate(from) ||
    !isValidDate(to) ||
    Date.parse(to) < Date.parse(from) ||
    Date.parse(to) - Date.parse(from) > 30 * DAY
  )
    throw new AppError(400, 'date_range', 'Choose a valid date range of up to 31 days.');
  return {from, to};
}

/** UTC date (YYYY-MM-DD) `offsetDays` after the instant `at` (default: now). */
export const todayIso = (offsetDays = 0, at = Date.now()) => iso(at + offsetDays * DAY);
