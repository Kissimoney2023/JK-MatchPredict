export function probabilities(percent) {
  const vals = ['home', 'draw', 'away'].map((k) => {
    const v = percent?.[k];
    if (typeof v !== 'string' && typeof v !== 'number') return NaN;
    return Number(String(v).replace(/%$/, ''));
  });
  if (vals.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum < 98 || sum > 102) return null;
  const a = Math.round((vals[0] / sum) * 1000) / 10,
    b = Math.round((vals[1] / sum) * 1000) / 10;
  return [a, b, Math.round((100 - a - b) * 10) / 10];
}
export function isOpen(f, now = Date.now()) {
  return (
    f?.status === 'NS' && Number.isFinite(Date.parse(f.kickoff)) && Date.parse(f.kickoff) > now
  );
}
/** The finished regulation-time score, `{void: true}` for a cancelled match, null while open. */
export function finalScore(raw) {
  const status = raw?.fixture?.status?.short;
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(status)) return {void: true};
  if (!['FT', 'AET', 'PEN'].includes(status)) return null;
  const score = raw.score?.fulltime;
  if (
    !Number.isInteger(score?.home) ||
    !Number.isInteger(score?.away) ||
    score.home < 0 ||
    score.away < 0
  )
    return null;
  return {home: score.home, away: score.away};
}

export const GOAL_LINES = [0.5, 1.5, 2.5, 3.5];

/**
 * Settles one selection against the final score. Markets: 'result' (outcome 0/1/2 = home win,
 * draw, away win) and 'totals' (outcome 0 = over `line` goals, 1 = under). Null while the
 * match is not finished; 'void' when it was cancelled or awarded.
 */
export function settleSelection(raw, {market = 'result', line, outcome}) {
  const score = finalScore(raw);
  if (!score) return null;
  if (score.void) return {result: 'void', score: null};
  const text = `${score.home}–${score.away}`;
  if (market === 'totals') {
    const over = score.home + score.away > Number(line);
    return {result: (outcome === 0) === over ? 'correct' : 'incorrect', score: text};
  }
  const actual = score.home > score.away ? 0 : score.home === score.away ? 1 : 2;
  return {result: outcome === actual ? 'correct' : 'incorrect', score: text};
}

/** A home/draw/away pick against the final score (the original, single-market form). */
export const settle = (raw, outcome) => settleSelection(raw, {market: 'result', outcome});

/** Poisson chance of more than `line` goals, and of fewer (a whole-number line can push). */
function poissonOverUnder(lambda, line) {
  let term = Math.exp(-lambda);
  let under = 0;
  let upTo = 0; // P(total <= floor(line))
  for (let k = 0; k <= Math.floor(line); k++) {
    if (k < line) under += term;
    upTo += term;
    term = (term * lambda) / (k + 1);
  }
  return {over: 1 - upTo, under};
}

/**
 * Over/Under probabilities (percent) from the bookmakers' total line: the goal total at which
 * over and under are priced evenly. Assumes Poisson-distributed total goals, and solves for
 * the rate that makes over and under equally likely at that line (pushes excluded). Null for
 * an unusable line. No both-teams-to-score: a total says nothing about how goals split.
 */
export function goalsFromTotalLine(total) {
  const line = Number(total);
  if (!Number.isFinite(line) || line <= 0 || line > 8) return null;
  // A quarter line (2.75) is half a bet on each neighbouring line (2.5 and 3.0).
  const quarter = Math.round(line * 4) % 2 === 1;
  const at = (lambda) => {
    if (!quarter) return poissonOverUnder(lambda, line);
    const a = poissonOverUnder(lambda, line - 0.25);
    const b = poissonOverUnder(lambda, line + 0.25);
    return {over: (a.over + b.over) / 2, under: (a.under + b.under) / 2};
  };
  let lo = 0.1;
  let hi = 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const {over, under} = at(mid);
    if (over > under) hi = mid;
    else lo = mid;
  }
  const lambda = (lo + hi) / 2;
  const pct = (x) => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 10;
  const lines = GOAL_LINES.map((l) => {
    const over = pct(poissonOverUnder(lambda, l).over);
    return {line: l, over, under: Math.round((100 - over) * 10) / 10};
  });
  return {lines, btts: null, expectedTotal: Math.round(lambda * 100) / 100};
}
export function normalizeFixture(raw) {
  if (
    !Number.isInteger(raw?.fixture?.id) ||
    !raw.teams?.home?.name ||
    !raw.teams?.away?.name ||
    !Number.isFinite(Date.parse(raw.fixture.date))
  )
    return null;
  return {
    id: raw.fixture.id,
    competition: raw.league?.name,
    leagueKey: 'ap:' + raw.league?.id,
    apLeagueId: raw.league?.id,
    home: raw.teams.home.name,
    away: raw.teams.away.name,
    kickoff: raw.fixture.date,
    status: raw.fixture.status.short,
    round: raw.league.round,
    season: raw.league.season,
  };
}

// Keep provider ID spaces disjoint: positive = API-Football, negative = football-data.org.
export function normalizeFD(raw) {
  if (
    !Number.isSafeInteger(raw?.id) ||
    raw.id < 1 ||
    !raw.homeTeam?.name ||
    !raw.awayTeam?.name ||
    !Number.isFinite(Date.parse(raw.utcDate))
  )
    return null;
  const statuses = {
    TIMED: 'NS',
    SCHEDULED: 'TBD',
    IN_PLAY: 'LIVE',
    PAUSED: 'LIVE',
    FINISHED: 'FT',
    POSTPONED: 'PST',
    SUSPENDED: 'SUSP',
    CANCELLED: 'CANC',
    AWARDED: 'AWD',
  };
  return {
    id: -raw.id,
    competition: raw.competition?.name,
    leagueKey: 'fd:' + raw.competition?.code,
    fdCode: raw.competition?.code,
    externalId: raw.id,
    dataProvider: 'football-data.org',
    home: raw.homeTeam.name,
    away: raw.awayTeam.name,
    homeTeamId: raw.homeTeam.id,
    awayTeamId: raw.awayTeam.id,
    kickoff: raw.utcDate,
    status: statuses[raw.status] || 'UNKNOWN',
    round: raw.stage,
    season: Number(raw.season?.startDate?.slice(0, 4)),
  };
}
export function fdRegulation(raw) {
  return raw?.status === 'FINISHED' && raw.score?.duration === 'REGULAR'
    ? raw.score.fullTime
    : null;
}
export function fdSettlementRaw(raw) {
  return {
    fixture: {status: {short: normalizeFD(raw)?.status}},
    score: {fulltime: fdRegulation(raw)},
  };
}
export function teamKey(name) {
  const n = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(fc|cf|afc|ac|sc)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const aliases = {
    'paris saint germain': 'psg',
    'paris saint germain fc': 'psg',
    'paris sg': 'psg',
    'internazionale milano': 'inter',
    internazionale: 'inter',
    'inter milan': 'inter',
    'bayern munchen': 'bayern munich',
    'bayern munich': 'bayern munich',
    'borussia dortmund': 'dortmund',
    'atletico de madrid': 'atletico madrid',
    'sporting clube de portugal': 'sporting cp',
    'sporting lisbon': 'sporting cp',
  };
  return aliases[n] || n;
}
export function sameMatch(a, b) {
  return (
    teamKey(a.home) === teamKey(b.home) &&
    teamKey(a.away) === teamKey(b.away) &&
    Math.abs(Date.parse(a.kickoff) - Date.parse(b.kickoff)) <= 60000
  );
}
export function matchKey(f) {
  return JSON.stringify([
    f.canonicalLeague || f.leagueKey,
    teamKey(f.home),
    teamKey(f.away),
    f.kickoff.slice(0, 10),
  ]);
}
export function goalModel(homeMatches, awayMatches, homeId, awayId, kickoff, now = Date.now()) {
  const cutoff = Math.min(Date.parse(kickoff), now);
  const sample = (rows, id, venue) =>
    rows
      .filter(
        (r) =>
          r.status === 'FINISHED' &&
          Date.parse(r.utcDate) < cutoff &&
          r[venue + 'Team']?.id === id &&
          Number.isInteger(fdRegulation(r)?.home) &&
          Number.isInteger(fdRegulation(r)?.away) &&
          fdRegulation(r).home >= 0 &&
          fdRegulation(r).away >= 0,
      )
      .sort((a, b) => Date.parse(b.utcDate) - Date.parse(a.utcDate))
      .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
      .slice(0, 10);
  const h = sample(homeMatches, homeId, 'home'),
    a = sample(awayMatches, awayId, 'away');
  if (h.length < 5 || a.length < 5) return null;
  const mean = (rows, k) =>
    (rows.reduce((s, r) => s + fdRegulation(r)[k], 0) + 2 * 1.3) / (rows.length + 2);
  const lh = Math.min(5, Math.max(0.15, (mean(h, 'home') + mean(a, 'home')) / 2)),
    la = Math.min(5, Math.max(0.15, (mean(a, 'away') + mean(h, 'away')) / 2));
  const dist = (l) => {
    const p = [Math.exp(-l)];
    for (let i = 1; i <= 20; i++) p[i] = (p[i - 1] * l) / i;
    return p;
  };
  const hp = dist(lh),
    ap = dist(la),
    out = [0, 0, 0];
  for (let i = 0; i < hp.length; i++)
    for (let j = 0; j < ap.length; j++) out[i > j ? 0 : i === j ? 1 : 2] += hp[i] * ap[j];
  const total = out.reduce((s, v) => s + v, 0);
  const p = out.map((v) => (v / total) * 100);
  const first = Math.round(p[0] * 10) / 10,
    second = Math.round(p[1] * 10) / 10;
  return {
    p: [first, second, Math.round((100 - first - second) * 10) / 10],
    sampleHome: h.length,
    sampleAway: a.length,
    expectedGoals: [Math.round(lh * 100) / 100, Math.round(la * 100) / 100],
    modelVersion: 'jk-poisson-v1',
    explanation: `Experimental goal model using ${h.length} recent home games and ${a.length} recent away games, with light smoothing. Not calibrated or backtested; no injury, lineup or opponent-strength adjustment.`,
  };
}
