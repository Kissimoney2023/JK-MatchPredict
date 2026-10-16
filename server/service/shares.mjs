import {randomBytes} from 'node:crypto';
import {AppError} from '../errors.mjs';
import {HOUR} from '../util.mjs';
import {accuracyTrend, summarizePicks} from '../pickstats.mjs';

const SHARE_ID_FORMAT = /^[A-Za-z0-9_-]{12}$/;
const RECENT_PICKS = 10;
const TOP_COMPETITIONS = 5;
const MAX_TREND_POINTS = 60;
const MIN_TREND_SETTLED = 5;
const OUTCOME_NAMES = (p) => [`${p.forecast.home} win`, 'Draw', `${p.forecast.away} win`];

/** Whether a string looks like a share id (so odd URLs never reach the database). */
export const isShareId = (id) => SHARE_ID_FORMAT.test(String(id || ''));

/**
 * The accuracy-over-time series, thinned to at most 60 evenly spaced points (always keeping the
 * first and the last) and rounded, so a long history stays small in the stored snapshot.
 */
export function sampleTrend(points) {
  if (!Array.isArray(points) || points.length < MIN_TREND_SETTLED) return [];
  const round = (v) => Math.round(v * 1000) / 1000;
  const keep =
    points.length <= MAX_TREND_POINTS
      ? points
      : Array.from(
          {length: MAX_TREND_POINTS},
          (_, i) => points[Math.round((i * (points.length - 1)) / (MAX_TREND_POINTS - 1))],
        );
  return keep.map((p) => ({n: p.n, accuracy: round(p.accuracy), expected: round(p.expected)}));
}

/**
 * What a public link reveals: aggregate statistics and the last settled picks. Pending picks,
 * email addresses and anything else about the person are deliberately left out.
 */
export function buildSnapshot(picks, now) {
  const s = summarizePicks(picks);
  const settled = picks
    .filter((p) => (p.result === 'correct' || p.result === 'incorrect') && p.forecast)
    .sort((a, b) => Date.parse(b.forecast.kickoff) - Date.parse(a.forecast.kickoff))
    .slice(0, RECENT_PICKS);
  return {
    generatedAt: now,
    settled: s.settled,
    correct: s.correct,
    incorrect: s.incorrect,
    accuracy: s.accuracy,
    currentStreak: s.currentStreak,
    bestWinStreak: s.bestWinStreak,
    expectedCorrect: s.expectedCorrect,
    smallSample: s.smallSample,
    minReliableSample: s.minReliableSample,
    recent: s.recent,
    trend: sampleTrend(accuracyTrend(picks)),
    byCompetition: s.byCompetition
      .slice(0, TOP_COMPETITIONS)
      .map((c) => ({name: c.name, settled: c.settled, accuracy: c.accuracy})),
    picks: settled.map((p) => ({
      home: p.forecast.home,
      away: p.forecast.away,
      competition: p.forecast.competition,
      pick: OUTCOME_NAMES(p)[p.outcome],
      probability: p.forecast.p?.[p.outcome] ?? null,
      result: p.result,
      score: p.score ?? null,
      date: String(p.forecast.kickoff).slice(0, 10),
    })),
  };
}

/** Public share links, stored in Supabase (so they need an account). */
export function createShares({supabase, pickStore, storage, now}) {
  const {budget} = storage;

  function database() {
    if (!supabase) throw new AppError(503, 'accounts_disabled', 'Sharing is not configured.');
    return supabase;
  }

  async function existing(userId) {
    const rows = await database().select('shares', {user_id: 'eq.' + userId, limit: '1'});
    return rows?.[0] ?? null;
  }

  /** The person's current share state (for the dialog). */
  async function status(userId, origin) {
    const row = await existing(userId);
    if (!row) return {exists: false, enabled: false};
    return {
      exists: true,
      enabled: row.enabled,
      showName: row.show_name,
      url: row.enabled ? `${origin}/s/${row.id}` : null,
      updatedAt: Date.parse(row.updated_at),
    };
  }

  /**
   * Creates the person's public link, or refreshes its snapshot (the address stays the same)
   * and re-enables it. `displayName` is only stored when `showName` is true.
   */
  async function publish({userId, showName, displayName, origin}) {
    const db = database();
    await budget('share-' + userId, 10, HOUR);
    const picks = await pickStore.list('acct:' + userId);
    const snapshot = buildSnapshot(picks, now());
    if (!snapshot.settled)
      throw new AppError(
        409,
        'nothing_to_share',
        'Share links need at least one settled pick. Use “Check results” first.',
      );
    const fields = {
      enabled: true,
      show_name: !!showName,
      display_name: showName ? displayName || null : null,
      snapshot,
      updated_at: new Date(now()).toISOString(),
    };
    const row = await existing(userId);
    if (row) await db.update('shares', {user_id: 'eq.' + userId}, fields);
    else
      await db.insert('shares', [
        {user_id: userId, id: randomBytes(9).toString('base64url'), ...fields},
      ]);
    return status(userId, origin);
  }

  /** Switches the link off; the address stops working immediately. */
  async function disable(userId) {
    const row = await existing(userId);
    if (row) await database().update('shares', {user_id: 'eq.' + userId}, {enabled: false});
    return {exists: !!row, enabled: false};
  }

  /** The public snapshot for an id, or null when unknown or switched off. */
  async function get(id) {
    if (!isShareId(id)) return null;
    const rows = await database().select('shares', {
      id: 'eq.' + id,
      enabled: 'eq.true',
      limit: '1',
    });
    const row = rows?.[0];
    if (!row) return null;
    return {
      displayName: row.show_name ? row.display_name : null,
      snapshot: row.snapshot,
      updatedAt: Date.parse(row.updated_at),
    };
  }

  return {status, publish, disable, get};
}
