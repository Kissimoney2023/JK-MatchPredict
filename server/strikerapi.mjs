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
  UEL: 'uel',
  UECL: 'uecl',
};
export const saLeagueFor = (fdCode) => SA_LEAGUES[fdCode] ?? null;

/**
 * Competitions neither free football API lists, served from StrikerAPI alone: fixtures and
 * results from its schedule and games, forecasts from its market line. The codes are the
 * app's own (they look like football-data.org codes so every code-keyed feature works).
 */
export const SA_ONLY_COMPETITIONS = [
  {code: 'UEL', league: 'uel', name: 'UEFA Europa League', country: 'Europe'},
  {code: 'UECL', league: 'uecl', name: 'UEFA Conference League', country: 'Europe'},
];

/** StrikerAPI game status -> the app's (API-Football style) short status. */
export function saStatus(status) {
  const s = String(status ?? '').toLowerCase();
  if (!s || s === 'scheduled' || s === 'pre' || s === 'upcoming') return 'NS';
  if (s === 'final' || s === 'finished' || s === 'ft' || s === 'full_time') return 'FT';
  if (s === 'postponed') return 'PST';
  if (s === 'cancelled' || s === 'canceled') return 'CANC';
  if (s === 'abandoned') return 'ABD';
  if (/live|progress|half|1st|2nd|ht/.test(s)) return '1H';
  return 'TBD';
}

const saScore = (side) => {
  const v = side?.score ?? side?.goals;
  return Number.isInteger(Number(v)) && v !== null && v !== '' ? Number(v) : null;
};

/** A StrikerAPI game (schedule or list_games row) as one of the app's fixtures, or null. */
export function normSA(game, competition) {
  const id = game?.game_id ?? game?.id;
  const kickoff = game?.starts_at ?? game?.date ?? game?.kickoff;
  if (!id || !game?.home?.name || !game?.away?.name || !Number.isFinite(Date.parse(kickoff)))
    return null;
  const home = saScore(game.home);
  const away = saScore(game.away);
  return {
    id: String(id),
    key: 'sa:' + id,
    provider: 'sa',
    externalId: String(id),
    competition: competition.name,
    leagueKey: 'sa:' + competition.league,
    home: game.home.name,
    away: game.away.name,
    kickoff: new Date(kickoff).toISOString(),
    status: saStatus(game.status),
    score: home !== null && away !== null ? {home, away} : null,
    fdCode: competition.code,
    canonicalLeague: competition.code,
    season: game.season ?? null,
  };
}

/** A StrikerAPI game as the raw shape the settlement helpers read. */
export const saSettlementRaw = (game) => ({
  fixture: {status: {short: saStatus(game?.status)}},
  score: {fulltime: {home: saScore(game?.home), away: saScore(game?.away)}},
});

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

// Letters that Unicode normalisation does not decompose; mapped before names are compared.
const TRANSLITERATE = {ø: 'o', æ: 'ae', å: 'a', ß: 'ss', đ: 'd', ł: 'l', ı: 'i', œ: 'oe'};

// Local spellings versus the English ones the other provider uses.
const WORD_ALIASES = {
  praha: 'prague',
  munchen: 'munich',
  koln: 'cologne',
  wien: 'vienna',
  milano: 'milan',
  lisboa: 'lisbon',
  kobenhavn: 'copenhagen',
  beograd: 'belgrade',
  kyiv: 'kiev',
  olympiakos: 'olympiacos',
  paphos: 'pafos',
  st: 'saint',
  brestois: 'brest',
  lyonnais: 'lyon',
  crvena: 'red',
  zvezda: 'star',
};

// Club-type words that add nothing to identity ("SK Slavia", "SL Benfica", "Lille OSC").
const GENERIC_WORDS = new Set([
  'fc',
  'cf',
  'afc',
  'ac',
  'sc',
  'sk',
  'fk',
  'bk',
  'sv',
  'ss',
  'ssc',
  'as',
  'us',
  'cd',
  'ud',
  'sd',
  'rc',
  'rcd',
  'fsv',
  'vfb',
  'vfl',
  'tsg',
  'sl',
  'gnk',
  'nk',
  'kv',
  'kaa',
  'rsc',
  'osc',
  'club',
  'stade',
  'de',
  'la',
  'le',
  'the',
]);

const transliterate = (s) =>
  [...String(s).toLowerCase()].map((c) => TRANSLITERATE[c] ?? c).join('');
const isNumber = (t) => [...t].every((c) => c >= '0' && c <= '9');

/** The distinctive words of a team name, normalised across spellings and providers. */
function tokens(name) {
  const all = teamKey(transliterate(name))
    .split(' ')
    .filter(Boolean)
    .map((t) => WORD_ALIASES[t] ?? t);
  const distinctive = all.filter((t) => !GENERIC_WORDS.has(t) && !isNumber(t));
  return distinctive.length ? distinctive : all;
}

/** True when one team name's words are all contained in the other's ("Arsenal FC" ~ "Arsenal"). */
export function sameTeam(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((t) => long.includes(t));
}

const SAME_KICKOFF_MS = 30 * 60_000;

/**
 * The StrikerAPI schedule game that matches a fixture.
 *  1. Both teams match and the kickoff is within 3 hours: the normal case.
 *  2. Otherwise, one side matches (home with home, away with away) and the kickoff is within
 *     30 minutes. A team cannot play two matches at once, so if exactly one such game exists
 *     it is the right one even when the other club's name is spelled in an unknown way.
 */
export function findGame(games, fixture, toleranceMs = 3 * 3_600_000) {
  const kickoff = Date.parse(fixture.kickoff);
  const gap = (g) => Math.abs(Date.parse(g.starts_at) - kickoff);

  const both = games.find(
    (g) =>
      gap(g) <= toleranceMs &&
      sameTeam(g.home?.name, fixture.home) &&
      sameTeam(g.away?.name, fixture.away),
  );
  if (both) return both;

  const oneSide = games.filter(
    (g) =>
      gap(g) <= SAME_KICKOFF_MS &&
      (sameTeam(g.home?.name, fixture.home) || sameTeam(g.away?.name, fixture.away)),
  );
  return oneSide.length === 1 ? oneSide[0] : null;
}

/** Elo expected score (win = 1, draw = 0.5) for the home side; StrikerAPI uses +60 for home. */
export function eloExpectedScore(homeElo, awayElo, homeAdvantage = 60) {
  return 1 / (1 + 10 ** (-(homeElo + homeAdvantage - awayElo) / 400));
}
