import {hash} from '../util.mjs';

const PENDING = 'clv/pending'; // matches with picks, kept by the closing-line service
const ATTEMPTS = 'lineups/attempts';
const WINDOW_BEFORE_MS = 75 * 60_000; // line-ups are named about an hour before kickoff
const WINDOW_AFTER_MS = 15 * 60_000;
const MAX_PER_RUN = 4; // 5 credits each
const MAX_ATTEMPTS = 3; // per match: the first tries may be before the teams are named
const KEEP_MS = 3 * 24 * 3_600_000;
const KEY = (canonical) => 'lineups/' + hash(canonical);

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** One side's line-up from a response side object; null unless at least seven starters are named. */
function parseSide(side) {
  if (!side || typeof side !== 'object') return null;
  const list =
    side.starters ?? side.starting_xi ?? side.starting ?? side.lineup ?? side.players ?? [];
  const starters = (Array.isArray(list) ? list : [])
    .filter((p) => !p?.substitute && !p?.bench && p?.started !== false)
    .map((p) => ({
      name: text(p?.name ?? p?.player ?? p?.player_name),
      position: text(p?.position ?? p?.pos),
      number: Number.isFinite(Number(p?.number ?? p?.shirt)) ? Number(p?.number ?? p?.shirt) : null,
    }))
    .filter((p) => p.name)
    .slice(0, 11);
  if (starters.length < 7) return null;
  return {
    team: text(side.name ?? side.team ?? side.team_name),
    formation: text(side.formation),
    starters,
  };
}

/** Both line-ups from a get_lineups body, or null while the teams are not named. */
export function parseLineups(body) {
  const home = parseSide(body?.home ?? body?.home_team ?? body?.lineups?.home);
  const away = parseSide(body?.away ?? body?.away_team ?? body?.lineups?.away);
  return home && away ? {home, away} : null;
}

/**
 * Confirmed line-ups for matches people picked, fetched once named (about an hour before
 * kickoff) and shown on the analysis. Each lookup costs credits, so only picked matches, a
 * few per run, with a few attempts each.
 */
export function createLineups({storage, strikerApi, now}) {
  const {read, atomic} = storage;

  async function capture() {
    const summary = {due: 0, fetched: 0, captured: 0, errors: 0};
    if (!strikerApi.enabled()) return summary;
    const t = now();
    const pending = (await read(PENDING))?.items ?? [];
    const attempts = (await read(ATTEMPTS))?.by ?? {};
    const due = pending.filter((i) => {
      const kickoff = Date.parse(i.kickoff);
      return (
        kickoff - t <= WINDOW_BEFORE_MS &&
        kickoff + WINDOW_AFTER_MS > t &&
        (attempts[i.canonical] ?? 0) < MAX_ATTEMPTS
      );
    });
    summary.due = due.length;
    const tried = {};
    for (const item of due.slice(0, MAX_PER_RUN)) {
      if (await read(KEY(item.canonical))) continue; // already have them
      tried[item.canonical] = (attempts[item.canonical] ?? 0) + 1;
      try {
        const where = await strikerApi.gameIdFor(item);
        if (!where) continue;
        summary.fetched++;
        const r = await strikerApi.lineups(where.league, where.gameId);
        const parsed = parseLineups(r.body);
        if (!parsed) continue; // not named yet; try again next run
        await atomic(KEY(item.canonical), () => ({...parsed, at: t}));
        summary.captured++;
      } catch (e) {
        summary.errors++;
        console.error('line-ups failed', item.home, item.away, e?.message ?? e);
      }
    }
    if (Object.keys(tried).length)
      await atomic(ATTEMPTS, (old) => {
        const by = {...(old?.by ?? {}), ...tried};
        // Forget matches that are long over.
        const keep = new Set(
          pending.filter((i) => Date.parse(i.kickoff) > t - KEEP_MS).map((i) => i.canonical),
        );
        for (const k of Object.keys(by)) if (!keep.has(k)) delete by[k];
        return {by};
      }).catch(() => {});
    return summary;
  }

  /** Stored line-ups for a match, or null. */
  const get = (canonical) => (canonical ? read(KEY(canonical)) : Promise.resolve(null));

  return {capture, get};
}
