import {teamKey} from './model.mjs';

/** football-data.org competition code -> StrikerAPI `league` argument. */
export const SA_LEAGUES = {
  CL: 'ucl',
  PL: 'soccer',
  PD: 'laliga',
  BL1: 'bundesliga',
  SA: 'seriea',
  FL1: 'ligue1',
  DED: 'eredivisie',
  PPL: 'primeira',
  ELC: 'championship',
  BSA: 'brazil',
};
export const saLeagueFor = (fdCode) => SA_LEAGUES[fdCode] ?? null;

const round1 = (x) => Math.round(x * 10) / 10;

/** Implied probability (0..1, margin included) of an American moneyline, or null. */
export function americanToProbability(ml) {
  if (!Number.isFinite(ml) || ml === 0) return null;
  return ml > 0 ? 100 / (ml + 100) : -ml / (-ml + 100);
}

/**
 * Removes the bookmaker margin from implied probabilities with Shin's method, which
 * assigns less probability to long shots than simple proportional scaling. Falls back
 * to proportional scaling if the solver cannot bracket a solution. Returns fractions
 * summing to 1.
 */
export function devigShin(implied) {
  const total = implied.reduce((s, v) => s + v, 0);
  const proportional = implied.map((v) => v / total);
  if (!(total > 1)) return proportional;

  const at = (z) =>
    implied.map((q) => (Math.sqrt(z * z + (4 * (1 - z) * q * q) / total) - z) / (2 * (1 - z)));
  const sumAt = (z) => at(z).reduce((s, v) => s + v, 0);

  let lo = 0;
  let hi = 0.999;
  if (!(sumAt(lo) > 1) || !(sumAt(hi) < 1)) return proportional;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (sumAt(mid) > 1) lo = mid;
    else hi = mid;
  }
  const fair = at((lo + hi) / 2);
  const norm = fair.reduce((s, v) => s + v, 0);
  return fair.map((v) => v / norm);
}

/**
 * Fair home/draw/away probabilities (percent, summing to exactly 100) from a StrikerAPI
 * `line` (median American moneylines across sportsbooks), or null if incomplete.
 */
export function marketFromLine(line) {
  const implied = [line?.home_ml, line?.draw_ml, line?.away_ml].map(americanToProbability);
  if (implied.some((v) => v === null)) return null;
  const fair = devigShin(implied);
  const first = round1(fair[0] * 100);
  const second = round1(fair[1] * 100);
  return {
    p: [first, second, round1(100 - first - second)],
    books: line.books ?? null,
    overround: round1((implied.reduce((s, v) => s + v, 0) - 1) * 100),
    total: line.total ?? null,
  };
}

const tokens = (name) => teamKey(name).split(' ').filter(Boolean);

/** True when one team name's words are all contained in the other's ("Arsenal FC" ~ "Arsenal"). */
export function sameTeam(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((t) => long.includes(t));
}

/** The StrikerAPI schedule game that matches a fixture (same teams, kickoff within 3 hours). */
export function findGame(games, fixture, toleranceMs = 3 * 3_600_000) {
  const kickoff = Date.parse(fixture.kickoff);
  return (
    games.find(
      (g) =>
        Math.abs(Date.parse(g.starts_at) - kickoff) <= toleranceMs &&
        sameTeam(g.home?.name, fixture.home) &&
        sameTeam(g.away?.name, fixture.away),
    ) ?? null
  );
}

/** Elo expected score (win = 1, draw = 0.5) for the home side; StrikerAPI uses +60 for home. */
export function eloExpectedScore(homeElo, awayElo, homeAdvantage = 60) {
  return 1 / (1 + 10 ** (-(homeElo + homeAdvantage - awayElo) / 400));
}
