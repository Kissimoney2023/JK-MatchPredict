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
export function settle(raw, outcome) {
  const status = raw?.fixture?.status?.short;
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(status)) return {result: 'void', score: null};
  if (!['FT', 'AET', 'PEN'].includes(status)) return null;
  const score = raw.score?.fulltime;
  if (
    !Number.isInteger(score?.home) ||
    !Number.isInteger(score?.away) ||
    score.home < 0 ||
    score.away < 0
  )
    return null;
  const actual = score.home > score.away ? 0 : score.home === score.away ? 1 : 2;
  return {
    result: outcome === actual ? 'correct' : 'incorrect',
    score: `${score.home}–${score.away}`,
  };
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
