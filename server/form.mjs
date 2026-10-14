import {fdRegulation} from './model.mjs';

const teamName = (t) => t?.shortName || t?.name || 'Unknown';
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Completed regulation-time matches from raw football-data rows: distinct, played before
 * `now`, newest first. Matches decided in extra time are skipped (regulation score unknown).
 */
export function finishedMatches(rows, now = Date.now()) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (r?.id == null || seen.has(r.id)) continue;
    seen.add(r.id);
    const t = Date.parse(r.utcDate);
    const score = fdRegulation(r);
    if (
      !(t < now) ||
      !Number.isInteger(score?.home) ||
      !Number.isInteger(score?.away) ||
      !Number.isInteger(r.homeTeam?.id) ||
      !Number.isInteger(r.awayTeam?.id)
    )
      continue;
    out.push({
      t,
      home: {id: r.homeTeam.id, name: teamName(r.homeTeam)},
      away: {id: r.awayTeam.id, name: teamName(r.awayTeam)},
      hg: score.home,
      ag: score.away,
    });
  }
  return out.sort((a, b) => b.t - a.t);
}

const letter = (gf, ga) => (gf > ga ? 'W' : gf === ga ? 'D' : 'L');

/** The team's last `n` results (newest first) with a W/D/L tally. */
export function recentForm(rows, teamId, now = Date.now(), n = 5) {
  const games = finishedMatches(rows, now)
    .filter((m) => m.home.id === teamId || m.away.id === teamId)
    .slice(0, n)
    .map((m) => {
      const isHome = m.home.id === teamId;
      return {
        result: letter(isHome ? m.hg : m.ag, isHome ? m.ag : m.hg),
        venue: isHome ? 'H' : 'A',
        opponent: isHome ? m.away.name : m.home.name,
        score: `${m.hg}–${m.ag}`,
        date: day(m.t),
      };
    });
  const count = (r) => games.filter((g) => g.result === r).length;
  return {games, record: {w: count('W'), d: count('D'), l: count('L')}};
}

/** Meetings between two specific teams found in the supplied rows (newest first). */
export function headToHead(rows, teamA, teamB, now = Date.now(), n = 5) {
  const meetings = finishedMatches(rows, now)
    .filter(
      (m) =>
        (m.home.id === teamA && m.away.id === teamB) ||
        (m.home.id === teamB && m.away.id === teamA),
    )
    .slice(0, n);
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  for (const m of meetings) {
    const a = m.home.id === teamA ? m.hg : m.ag;
    const b = m.home.id === teamA ? m.ag : m.hg;
    if (a > b) winsA++;
    else if (a < b) winsB++;
    else draws++;
  }
  return {
    winsA,
    draws,
    winsB,
    matches: meetings.map((m) => ({
      date: day(m.t),
      home: m.home.name,
      away: m.away.name,
      score: `${m.hg}–${m.ag}`,
    })),
  };
}
