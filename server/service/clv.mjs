import {hash} from '../util.mjs';
import {goalsFromTotalLine} from '../model.mjs';
import {findGame, marketFromLine, saLeagueFor} from '../strikerapi.mjs';

const PENDING = 'clv/pending'; // matches with picks whose closing line is still wanted
const MAX_PENDING = 500;
const CLOSE_WINDOW_MS = 75 * 60_000; // capture in the last 75 minutes before kickoff
const GRACE_MS = 2 * 3_600_000; // and still try shortly after kickoff if a run was missed
const FRESH_MS = 90 * 60_000; // a schedule fetched within this long counts as the close
const MAX_LEAGUES_PER_RUN = 5; // each fresh schedule costs credits
const CLOSE_KEY = (canonical) => 'clv/close/' + hash(canonical);

/** The chance (percent) a market snapshot gives one selection, or null. */
export function selectionChance(snapshot, pick) {
  if (!snapshot) return null;
  if (pick.market === 'totals') {
    const goals = goalsFromTotalLine(snapshot.total);
    const line = goals?.lines.find((l) => Number(l.line) === Number(pick.line));
    return line ? (pick.outcome === 0 ? line.over : line.under) : null;
  }
  const p = snapshot.p?.[pick.outcome];
  return Number.isFinite(p) ? p : null;
}

/**
 * Closing line value for one pick, from the market snapshot frozen in its forecast (the
 * opening chance) and the stored closing snapshot: `value` is close ÷ open − 1, so +0.05 means
 * the market moved 5% toward the pick before kickoff. Null when either side is missing.
 */
export function closingLineValue(pick, close) {
  const open = selectionChance(pick.forecast?.marketSnapshot, pick);
  const closed = selectionChance(close, pick);
  if (!open || !closed) return null;
  return {
    open,
    close: closed,
    value: Math.round((closed / open - 1) * 1000) / 1000,
    beatClose: closed > open,
    closedAt: close.at ?? null,
  };
}

/**
 * Closing line value. Picks keep the bookmakers' consensus as it was when they were made;
 * this records the consensus once more just before kickoff, per match (shared by everyone
 * who picked it), and reads the two back together.
 */
export function createClv({storage, strikerApi, now}) {
  const {read, atomic} = storage;

  /** Remembers a match whose closing line is worth recording (called when a pick is saved). */
  async function noteUpcoming(forecast) {
    if (!forecast?.marketSnapshot || !saLeagueFor(forecast.fdCode)) return;
    try {
      await atomic(PENDING, (old) => {
        const items = (old?.items ?? []).filter((i) => Date.parse(i.kickoff) > now() - GRACE_MS);
        if (items.some((i) => i.canonical === forecast.canonical)) return {items};
        items.push({
          canonical: forecast.canonical,
          home: forecast.home,
          away: forecast.away,
          kickoff: forecast.kickoff,
          fdCode: forecast.fdCode,
        });
        return {items: items.slice(-MAX_PENDING)};
      });
    } catch (e) {
      console.error('closing line bookkeeping failed', e?.message ?? e);
    }
  }

  /**
   * One pass of the scheduled job: for matches in the capture window, refresh each league's
   * schedule once and store the consensus as the close. Never throws.
   */
  async function captureClosings() {
    const summary = {due: 0, captured: 0, leagues: 0, errors: 0};
    if (!strikerApi.marketEnabled()) return summary;
    const t = now();
    const pending = (await read(PENDING))?.items ?? [];
    const due = pending.filter((i) => {
      const kickoff = Date.parse(i.kickoff);
      return kickoff - t <= CLOSE_WINDOW_MS && kickoff > t - GRACE_MS;
    });
    summary.due = due.length;
    if (!due.length) return summary;

    const byLeague = new Map();
    for (const item of due) {
      const league = saLeagueFor(item.fdCode);
      if (!league) continue;
      if (!byLeague.has(league)) byLeague.set(league, []);
      byLeague.get(league).push(item);
    }
    const done = new Set();
    for (const [league, items] of [...byLeague].slice(0, MAX_LEAGUES_PER_RUN)) {
      let games;
      try {
        games = (await strikerApi.schedule(league, FRESH_MS)).body.games ?? [];
        summary.leagues++;
      } catch (e) {
        summary.errors++;
        console.error('closing line schedule failed', league, e?.message ?? e);
        continue;
      }
      for (const item of items) {
        const game = findGame(games, item);
        const market = game && marketFromLine(game.line);
        if (!market) continue;
        try {
          await atomic(CLOSE_KEY(item.canonical), () => ({
            p: market.p,
            total: market.total ?? null,
            books: market.books ?? null,
            at: t,
          }));
          done.add(item.canonical);
          summary.captured++;
        } catch (e) {
          summary.errors++;
          console.error('closing line store failed', e?.message ?? e);
        }
      }
    }
    // Drop what was captured and what is too old to capture now.
    await atomic(PENDING, (old) => ({
      items: (old?.items ?? []).filter(
        (i) => !done.has(i.canonical) && Date.parse(i.kickoff) > t - GRACE_MS,
      ),
    })).catch(() => {});
    return summary;
  }

  /** Attaches `clv` to picks that have both an opening and a closing consensus. */
  async function decorate(picks) {
    const out = [];
    for (const pick of picks) {
      if (!pick.forecast?.marketSnapshot) {
        out.push(pick);
        continue;
      }
      const close = await read(CLOSE_KEY(pick.forecast.canonical ?? pick.canonical.split('|')[0]));
      const clv = close ? closingLineValue(pick, close) : null;
      out.push(clv ? {...pick, clv} : pick);
    }
    return out;
  }

  return {noteUpcoming, captureClosings, decorate};
}
