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

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
const GOAL_LINES = [0.5, 1.5, 2.5, 3.5];

/**
 * Season-style numbers for one team over its last `n` completed regulation-time matches,
 * optionally only those played at home or away. Null when the team has no such match.
 * Rates are fractions (0 to 1); `played` says how many matches they rest on.
 */
export function teamStats(rows, teamId, now = Date.now(), {n = 10, venue} = {}) {
  const games = finishedMatches(rows, now)
    .filter((m) => {
      const home = m.home.id === teamId;
      if (!home && m.away.id !== teamId) return false;
      return venue === 'home' ? home : venue === 'away' ? !home : true;
    })
    .slice(0, n)
    .map((m) => {
      const home = m.home.id === teamId;
      return {gf: home ? m.hg : m.ag, ga: home ? m.ag : m.hg};
    });
  if (!games.length) return null;
  const played = games.length;
  const share = (test) => round(games.filter(test).length / played, 3);
  const wins = games.filter((g) => g.gf > g.ga).length;
  const draws = games.filter((g) => g.gf === g.ga).length;
  return {
    played,
    wins,
    draws,
    losses: played - wins - draws,
    ppg: round((wins * 3 + draws) / played, 2),
    winRate: round(wins / played, 3),
    scored: round(games.reduce((s, g) => s + g.gf, 0) / played, 2),
    conceded: round(games.reduce((s, g) => s + g.ga, 0) / played, 2),
    cleanSheetRate: share((g) => g.ga === 0),
    failedToScoreRate: share((g) => g.gf === 0),
    bttsRate: share((g) => g.gf > 0 && g.ga > 0),
    over25Rate: share((g) => g.gf + g.ga > 2),
  };
}

/**
 * How often recent matches of the two teams went over each goal line and had both teams
 * score, pooling each team's last `n` matches (a meeting counted once). Observed frequencies,
 * not a forecast. Null with no matches.
 */
export function goalRates(rowsA, teamA, rowsB, teamB, now = Date.now(), n = 10) {
  const pick = (rows, id) =>
    finishedMatches(rows, now)
      .filter((m) => m.home.id === id || m.away.id === id)
      .slice(0, n);
  const pooled = new Map();
  for (const m of [...pick(rowsA, teamA), ...pick(rowsB, teamB)])
    pooled.set(`${m.t}-${m.home.id}-${m.away.id}`, m);
  const games = [...pooled.values()];
  if (!games.length) return null;
  const share = (test) => round(games.filter(test).length / games.length, 3);
  return {
    matches: games.length,
    lines: GOAL_LINES.map((line) => {
      const over = share((m) => m.hg + m.ag > line);
      return {line, over, under: round(1 - over, 3)};
    }),
    btts: share((m) => m.hg > 0 && m.ag > 0),
  };
}
