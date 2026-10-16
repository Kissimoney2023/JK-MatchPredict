import {todayIso} from '../util.mjs';

const DEFAULT_COMPETITIONS = 'CL,PL,PD,BL1,SA,FL1';
const LOOKAHEAD_MS = 36 * 3_600_000; // matches starting within this long are candidates
const MAX_FORECASTS = 8; // forecasts cost provider requests, so only the first few candidates
const KEEP = 3; // best picks stored, so a second is ready when the first kicks off
const REFRESH_MS = 6 * 3_600_000; // do not recompute more often than this
const MAX_AGE_MS = 30 * 3_600_000; // a stored result older than this is not shown
const TIME_BUDGET_MS = 25_000; // the scheduled job has 60 seconds; leave room for the rest
const KEY = 'potd/current';

/**
 * "Pick of the day": the upcoming match in the main competitions whose forecast has the
 * clearest favourite. It is chosen by the scheduled job and stored; visitors only read the
 * stored result, so showing it costs no provider requests. "Clearest" means the highest
 * probability for one outcome among forecasts that clear the app's own bar for separation
 * (not "Low separation"); it is a probability, not a recommendation to bet.
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

  /** Chooses and stores today's picks. Never throws; a failed run keeps the previous result. */
  async function compute() {
    const started = now();
    const codes = competitions();
    const pool = await candidates(codes);
    const chosen = [];
    let checked = 0;
    for (const {fixture, listingId} of pool.slice(0, MAX_FORECASTS)) {
      if (now() - started > TIME_BUDGET_MS) break;
      try {
        const record = await forecast(fixture.key, listingId);
        checked++;
        if (record?.analysis && record.analysis.strength !== 'Low separation')
          chosen.push(summary(fixture, listingId, record));
      } catch {
        // No forecast for this match (no history, no odds): it simply cannot be the pick.
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
    return {candidates: pool.length, checked, stored: true, picked: chosen[0]?.key ?? null};
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

  /** What the dashboard shows: the best stored pick that has not kicked off yet, or null. */
  async function current() {
    const stored = await read(KEY);
    const t = now();
    if (!stored || t - stored.computedAt > MAX_AGE_MS) return {pick: null};
    const pick = (stored.picks ?? []).find((p) => Date.parse(p.kickoff) > t) ?? null;
    return pick
      ? {
          pick,
          checked: stored.checked,
          candidates: stored.candidates,
          computedAt: stored.computedAt,
        }
      : {pick: null};
  }

  return {current, refresh};
}
