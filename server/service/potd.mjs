import {todayIso} from '../util.mjs';
import {wilson} from '../pickstats.mjs';

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
const HISTORY = 'potd/history'; // every pick that was shown, with its result once known
const MAX_HISTORY = 300;
const SETTLE_AFTER_MS = 105 * 60_000; // matches are rarely over sooner than this
const SETTLE_WINDOW_MS = 5 * 24 * 3_600_000; // older unsettled picks are left alone
const SETTLE_PER_RUN = 5; // result lookups cost provider requests
const MIN_RECORD = 5; // below this the track record is shown as "too few to judge"

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
export function createPickOfTheDay({env, now, storage, fixtures, forecast, settleMatch}) {
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
    provider: f.provider,
    fdCode: f.fdCode,
    canonicalLeague: f.canonicalLeague,
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
    await recordPicks(chosen.slice(0, KEEP));
    return {
      candidates: pool.length,
      checked,
      stored: true,
      picked: chosen.slice(0, KEEP).map((p) => p.key),
    };
  }

  /**
   * Remembers each pick that was shown (once), so its result can be recorded afterwards. The
   * track record therefore covers exactly what visitors were shown, good or bad.
   */
  async function recordPicks(picks) {
    try {
      await atomic(HISTORY, (old) => {
        const items = old?.items ?? [];
        const known = new Set(items.map((i) => i.key));
        const fresh = picks
          .filter((p) => !known.has(p.key))
          .map((p) => ({
            key: p.key,
            home: p.home,
            away: p.away,
            competition: p.competition,
            kickoff: p.kickoff,
            outcomeIndex: p.outcomeIndex,
            predictedOutcome: p.predictedOutcome,
            probability: p.probability,
            provider: p.provider,
            fdCode: p.fdCode,
            canonicalLeague: p.canonicalLeague,
            shownAt: now(),
            result: null,
            score: null,
          }));
        return fresh.length ? {items: [...fresh, ...items].slice(0, MAX_HISTORY)} : undefined;
      });
    } catch (e) {
      console.error('pick of the day history failed', e?.message ?? e);
    }
  }

  /**
   * Looks up results for shown picks whose match should be over (at most five a run, never for
   * matches older than five days) and records them. Failures just leave the pick unsettled.
   */
  async function settleHistory() {
    if (!settleMatch) return 0;
    const history = await read(HISTORY);
    const t = now();
    const due = (history?.items ?? [])
      .filter((i) => {
        const kickoff = Date.parse(i.kickoff);
        return !i.result && kickoff + SETTLE_AFTER_MS < t && kickoff > t - SETTLE_WINDOW_MS;
      })
      .slice(0, SETTLE_PER_RUN);
    const found = new Map();
    for (const item of due) {
      try {
        const outcome = await settleMatch(item, item.outcomeIndex);
        if (outcome) found.set(item.key, outcome);
      } catch {
        // The provider has nothing yet: try again next run.
      }
    }
    if (!found.size) return 0;
    await atomic(HISTORY, (old) => ({
      items: (old?.items ?? []).map((i) =>
        found.has(i.key) && !i.result
          ? {...i, result: found.get(i.key).result, score: found.get(i.key).score ?? null}
          : i,
      ),
    }));
    return found.size;
  }

  /** How the picks of the day have done: correct of settled (void and unsettled not counted). */
  async function trackRecord() {
    const items = (await read(HISTORY))?.items ?? [];
    const done = items.filter((i) => i.result === 'correct' || i.result === 'incorrect');
    if (!done.length) return null;
    const correct = done.filter((i) => i.result === 'correct').length;
    const interval = wilson(correct, done.length);
    return {
      settled: done.length,
      correct,
      rate: interval.rate,
      low: interval.low,
      high: interval.high,
      reliable: done.length >= MIN_RECORD,
    };
  }

  /** Recomputes unless a recent result exists (the scheduled job calls this every run). */
  async function refresh({force = false} = {}) {
    try {
      // Results are recorded on every run, whether or not the picks are recomputed.
      const settled = await settleHistory().catch((e) => {
        console.error('pick of the day results failed', e?.message ?? e);
        return 0;
      });
      const old = await read(KEY);
      if (!force && old && now() - old.computedAt < REFRESH_MS) return {skipped: true, settled};
      return {...(await compute()), settled};
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
    const result = await currentPicks();
    return result.picks.length ? {...result, record: await trackRecord()} : result;
  }

  async function currentPicks() {
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
