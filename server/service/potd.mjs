import {todayIso} from '../util.mjs';

const DEFAULT_COMPETITIONS = 'CL,PL,PD,BL1,SA,FL1';
const LOOKAHEAD_MS = 36 * 3_600_000; // matches starting within this long are candidates
const MAX_FORECASTS = 8; // forecasts cost provider requests, so only the first few candidates
const KEEP = 3; // the dashboard shows the three clearest winners
const REFRESH_MS = 6 * 3_600_000; // the scheduled job does not recompute more often than this
const MAX_AGE_MS = 30 * 3_600_000; // a stored result older than this is not shown
const TIME_BUDGET_MS = 25_000; // the scheduled job has 60 seconds; leave room for the rest
const LAZY_FORECASTS = 5; // a visitor-triggered run is smaller and quicker
const LAZY_BUDGET_MS = 8_000;
const LAZY_WINDOW_MS = 20 * 60_000; // at most one visitor-triggered run per window, site-wide
const KEY = 'potd/current';
const ATTEMPT = 'potd/attempt';

/**
 * "Picks of the day": the upcoming matches in the main competitions whose forecast has the
 * clearest winner. The three with the highest probability for a home or away win (draws are not
 * winners) among forecasts that clear the app's own bar for separation ("not Low separation")
 * are stored and shown. These are probabilities, not recommendations to bet.
 *
 * The scheduled job computes them with the full budget. If nothing is stored when someone
 * opens the page (the job has not run yet), one visitor per 20 minutes triggers a smaller run
 * so the dashboard is not empty; everyone else just reads the stored result.
 */
export function createPickOfTheDay({env, now, storage, fixtures, forecast}) {
  const {read, atomic} = storage;

  const competitions = () =>
    (env.POTD_COMPETITIONS || DEFAULT_COMPETITIONS)
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);

  /** Open matches in the chosen competitions starting soon, most important competition first. */
  async function candidates(codes) {
    const t = now();
    const found = new Map();
    for (const offset of [0, 1]) {
      const day = todayIso(offset, t);
      try {
        const list = await fixtures(new URLSearchParams({from: day, to: day}));
        for (const f of list.fixtures)
          if (
            f.status === 'NS' &&
            codes.includes(f.canonicalLeague) &&
            Date.parse(f.kickoff) > t &&
            Date.parse(f.kickoff) - t <= LOOKAHEAD_MS
          )
            found.set(f.key, {fixture: f, listingId: list.listingId});
      } catch {
        // One day failing (quota, outage) should not stop the other.
      }
    }
    return [...found.values()].sort(
      (a, b) =>
        codes.indexOf(a.fixture.canonicalLeague) - codes.indexOf(b.fixture.canonicalLeague) ||
        Date.parse(a.fixture.kickoff) - Date.parse(b.fixture.kickoff),
    );
  }

  /** The stored shape: only what the dashboard card needs. */
  const summary = (f, listingId, record) => ({
    key: f.key,
    listingId,
    home: f.home,
    away: f.away,
    competition: f.competition,
    kickoff: f.kickoff,
    p: record.p,
    outcomeIndex: record.analysis.outcomeIndex,
    predictedOutcome: record.analysis.predictedOutcome,
    probability: record.analysis.probability,
    margin: record.analysis.margin,
    source: record.source,
  });

  /** Chooses and stores the picks. Never throws; a failed run keeps the previous result. */
  async function compute({maxForecasts = MAX_FORECASTS, timeBudget = TIME_BUDGET_MS} = {}) {
    const started = now();
    const codes = competitions();
    const pool = await candidates(codes);
    const chosen = [];
    let checked = 0;
    for (const {fixture, listingId} of pool.slice(0, maxForecasts)) {
      if (now() - started > timeBudget) break;
      try {
        const record = await forecast(fixture.key, listingId);
        checked++;
        const a = record?.analysis;
        // A winner pick: a clear favourite that is one of the teams, not a draw.
        if (a && a.strength !== 'Low separation' && a.outcomeIndex !== 1)
          chosen.push(summary(fixture, listingId, record));
      } catch {
        // No forecast for this match (no history, no odds): it simply cannot be a pick.
      }
    }
    if (!pool.length || !checked) return {candidates: pool.length, checked, stored: false};

    chosen.sort((a, b) => b.probability - a.probability || b.margin - a.margin);
    await atomic(KEY, () => ({
      computedAt: now(),
      candidates: pool.length,
      checked,
      picks: chosen.slice(0, KEEP),
    }));
    return {
      candidates: pool.length,
      checked,
      stored: true,
      picked: chosen.slice(0, KEEP).map((p) => p.key),
    };
  }

  /** Recomputes unless a recent result exists (the scheduled job calls this every run). */
  async function refresh({force = false} = {}) {
    try {
      const old = await read(KEY);
      if (!force && old && now() - old.computedAt < REFRESH_MS) return {skipped: true};
      return await compute();
    } catch (e) {
      console.error('pick of the day failed', e?.message ?? e);
      return {error: 'Pick of the day failed.'};
    }
  }

  const openPicks = (stored) =>
    stored && now() - stored.computedAt <= MAX_AGE_MS
      ? (stored.picks ?? []).filter((p) => Date.parse(p.kickoff) > now())
      : [];

  /**
   * Takes the right to run one visitor-triggered computation, if nobody has in the last 20
   * minutes. Returns true for exactly one caller per window.
   */
  async function claimLazyRun() {
    const claimed = await atomic(ATTEMPT, (old) =>
      old && now() - old.at < LAZY_WINDOW_MS ? undefined : {at: now(), done: false},
    );
    return claimed !== null;
  }

  /**
   * What the dashboard shows: up to three picks that have not kicked off. `pending` tells the
   * page that a first computation is under way, so it can say so and look again shortly.
   */
  async function current() {
    const before = await read(KEY);
    let picks = openPicks(before);
    let pending = false;
    // Nothing worked out recently that qualified: do not spend requests looking again.
    const nothingQualified =
      before && now() - before.computedAt < REFRESH_MS && !(before.picks ?? []).length;

    if (!picks.length && !nothingQualified) {
      try {
        if (await claimLazyRun()) {
          try {
            await compute({maxForecasts: LAZY_FORECASTS, timeBudget: LAZY_BUDGET_MS});
          } finally {
            await atomic(ATTEMPT, (old) => ({...(old ?? {at: now()}), done: true}));
          }
        }
      } catch (e) {
        console.error('pick of the day (first run) failed', e?.message ?? e);
      }
      const after = await read(KEY);
      picks = openPicks(after);
      const attempt = await read(ATTEMPT);
      pending = !picks.length && !!attempt && !attempt.done;
      if (picks.length)
        return {
          picks,
          checked: after.checked,
          candidates: after.candidates,
          computedAt: after.computedAt,
        };
      return {picks: [], pending};
    }

    return picks.length
      ? {
          picks,
          checked: before.checked,
          candidates: before.candidates,
          computedAt: before.computedAt,
        }
      : {picks: [], pending: false};
  }

  return {current, refresh};
}
