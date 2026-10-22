import {finalScore} from '../model.mjs';
import {addResult, emptyAggregate, summarizeAggregate} from '../calibration.mjs';

const PENDING = 'cal/pending'; // forecasts awaiting a result, keyed by match and source
const RESULTS = 'cal/results'; // the aggregates
const MAX_PENDING = 800;
const SETTLE_AFTER_MS = 105 * 60_000;
const SETTLE_WINDOW_MS = 5 * 24 * 3_600_000;
const MAX_LOOKUPS_PER_RUN = 6; // result lookups cost provider requests
const REPORT_MEMO_MS = 5 * 60_000;

export const SOURCE_LABELS = {
  market: 'Bookmakers’ consensus (StrikerAPI)',
  'api-football': 'API-Football prediction',
  ratings: 'JK ratings model',
  legacy: 'JK goal-average model',
};

/** Which of the four sources produced a forecast record. */
export function sourceKey(record) {
  const v = String(record?.modelVersion || '');
  if (v.startsWith('market')) return 'market';
  if (v === 'jk-ratings-v2' || v === 'jk-ratings-v3') return 'ratings';
  if (v === 'jk-poisson-v1') return 'legacy';
  return 'api-football';
}

/**
 * The live record of the app's own forecasts: each one is logged as shown and settled when
 * the match is over, so the page can say how often "60%" really happened, per source and per
 * competition. Only aggregates are kept.
 */
export function createCalibration({storage, now, lookup}) {
  const {read, atomic} = storage;
  let memo = null;

  /** Remembers a forecast (the latest per match and source wins). Never throws. */
  async function log(record) {
    try {
      if (!record?.canonical || !Array.isArray(record.p) || !record.kickoff) return;
      const source = sourceKey(record);
      const line = record.goals?.lines?.find((l) => Number(l.line) === 2.5);
      const item = {
        canonical: record.canonical,
        source,
        key: record.key,
        provider: record.provider,
        fdCode: record.fdCode ?? null,
        competition: record.canonicalLeague ?? record.fdCode ?? record.competition ?? 'other',
        home: record.home,
        away: record.away,
        kickoff: record.kickoff,
        p: record.p,
        over25: line ? line.over : null,
        at: now(),
      };
      await atomic(PENDING, (old) => {
        const t = now();
        const items = (old?.items ?? []).filter(
          (i) =>
            Date.parse(i.kickoff) > t - SETTLE_WINDOW_MS &&
            !(i.canonical === item.canonical && i.source === item.source),
        );
        items.push(item);
        return {items: items.slice(-MAX_PENDING)};
      });
    } catch (e) {
      console.error('forecast record log failed', e?.message ?? e);
    }
  }

  /** One pass of the scheduled job: settles finished matches into the aggregates. */
  async function settle() {
    const summary = {due: 0, settled: 0, lookups: 0, errors: 0};
    const t = now();
    const pending = (await read(PENDING))?.items ?? [];
    const due = pending.filter((i) => {
      const kickoff = Date.parse(i.kickoff);
      return kickoff + SETTLE_AFTER_MS < t && kickoff > t - SETTLE_WINDOW_MS;
    });
    summary.due = due.length;
    if (!due.length) return summary;

    // One lookup per match serves every source that forecast it.
    const byMatch = new Map();
    for (const item of due) {
      if (!byMatch.has(item.canonical)) byMatch.set(item.canonical, []);
      byMatch.get(item.canonical).push(item);
    }
    const settled = [];
    for (const [, items] of [...byMatch].slice(0, MAX_LOOKUPS_PER_RUN)) {
      summary.lookups++;
      let score;
      try {
        score = finalScore((await lookup.fresh(items[0])).raw);
      } catch {
        continue; // nothing yet, or the provider is busy: next run
      }
      if (!score) continue;
      for (const item of items) settled.push({item, score});
    }
    if (!settled.length) return summary;

    await atomic(RESULTS, (old) => {
      const results = old ?? {sources: {}, competitions: {}, updatedAt: null};
      for (const {item, score} of settled) {
        if (score.void) continue;
        const outcome = score.home > score.away ? 0 : score.home === score.away ? 1 : 2;
        const p = item.p.map((v) => v / 100);
        const over = Number.isFinite(item.over25) ? item.over25 / 100 : null;
        const overHappened = over === null ? null : score.home + score.away > 2.5;
        results.sources[item.source] = addResult(
          results.sources[item.source] ?? emptyAggregate(),
          p,
          outcome,
          over,
          overHappened,
        );
        const key = `${item.source}|${item.competition}`;
        results.competitions[key] = addResult(
          results.competitions[key] ?? emptyAggregate(),
          p,
          outcome,
          over,
          overHappened,
        );
      }
      results.updatedAt = t;
      return results;
    });
    summary.settled = settled.filter((s) => !s.score.void).length;

    const done = new Set(settled.map((s) => `${s.item.canonical}|${s.item.source}`));
    await atomic(PENDING, (old) => ({
      items: (old?.items ?? []).filter(
        (i) =>
          !done.has(`${i.canonical}|${i.source}`) && Date.parse(i.kickoff) > t - SETTLE_WINDOW_MS,
      ),
    })).catch(() => {});
    memo = null;
    return summary;
  }

  /** The page's data: per source and per competition, readable numbers only. */
  async function report() {
    if (memo && now() - memo.at < REPORT_MEMO_MS) return memo.value;
    const results = await read(RESULTS);
    const pending = (await read(PENDING))?.items ?? [];
    const sources = Object.entries(results?.sources ?? {})
      .map(([key, agg]) => ({key, label: SOURCE_LABELS[key] ?? key, ...summarizeAggregate(agg)}))
      .filter((s) => s.n)
      .sort((a, b) => b.n - a.n);
    const competitions = Object.entries(results?.competitions ?? {})
      .map(([key, agg]) => {
        const [source, competition] = key.split('|');
        const s = summarizeAggregate(agg);
        return {source, competition, n: s.n, accuracy: s.accuracy, logLoss: s.logLoss};
      })
      .filter((c) => c.n)
      .sort((a, b) => b.n - a.n);
    const value = {
      updatedAt: results?.updatedAt ?? null,
      awaiting: pending.length,
      sources,
      competitions,
    };
    memo = {at: now(), value};
    return value;
  }

  return {log, settle, report};
}
