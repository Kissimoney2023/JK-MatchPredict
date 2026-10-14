import {normalizeFixture, normalizeFD} from '../model.mjs';

/** API-Football league id -> football-data.org competition code (verified overlaps only). */
export const LEAGUE_MAPPING = {
  2: 'CL',
  39: 'PL',
  40: 'ELC',
  78: 'BL1',
  140: 'PD',
  135: 'SA',
  61: 'FL1',
  94: 'PPL',
  88: 'DED',
  71: 'BSA',
  1: 'WC',
  4: 'EC',
};

export function normAP(raw) {
  const f = normalizeFixture(raw);
  if (!f) return null;
  return {
    ...f,
    key: 'ap:' + f.id,
    provider: 'ap',
    externalId: f.id,
    score: raw.goals,
    fdCode: LEAGUE_MAPPING[f.apLeagueId],
    canonicalLeague: LEAGUE_MAPPING[f.apLeagueId] || f.leagueKey,
  };
}

export function normFD(raw) {
  const f = normalizeFD(raw);
  if (!f) return null;
  return {
    ...f,
    key: 'fd:' + f.externalId,
    provider: 'fd',
    score: raw.score?.fullTime,
    canonicalLeague: f.fdCode,
  };
}
