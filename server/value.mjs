// Value and staking arithmetic for virtual picks. No imports: this file is also published to
// the browser (as /value.js), like analysis.mjs and pickstats.mjs.
//
// Everything here is plain arithmetic on a probability and a price. Whether the probability
// deserves trust is a separate question that the page answers next to the numbers.

export const KELLY_FRACTION = 0.25; // quarter Kelly: the usual retail compromise
export const STAKE_CAP = 0.02; // never more than 2% of the bankroll on one bet
export const DEFAULT_BANKROLL = 100;

const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

/**
 * A price typed by a person, as decimal odds: "2.25", "2,25", "5/4" (fractional) or "+125" /
 * "-110" (American). Null when it is not a usable price (decimal odds must exceed 1).
 */
export function parseOdds(text) {
  const s = String(text ?? '')
    .trim()
    .replace(',', '.');
  if (!s) return null;
  let odds = null;
  if (/^[+-]\d+(\.\d+)?$/.test(s) && Math.abs(Number(s)) >= 100) {
    const n = Number(s);
    odds = n > 0 ? 1 + n / 100 : 1 + 100 / -n;
  } else if (/^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/.test(s)) {
    const [a, b] = s.split('/').map(Number);
    odds = b > 0 ? 1 + a / b : null;
  } else if (/^\d+(\.\d+)?$/.test(s)) odds = Number(s);
  return Number.isFinite(odds) && odds > 1 && odds < 1000 ? round(odds, 3) : null;
}

/** The chance a decimal price implies (fraction), before any margin is removed. */
export const impliedProbability = (odds) => (odds > 1 ? 1 / odds : null);

/** Expected return per unit staked (fraction): +0.10 means ten cents won per unit, on average. */
export const expectedValue = (probability, odds) => probability * odds - 1;

/**
 * Suggested stake as a fraction of the bankroll: Kelly's optimum scaled by `fraction` and
 * capped at `cap`. Zero when there is no edge (the full Kelly fraction is not positive).
 */
export function kellyStake(probability, odds, {fraction = KELLY_FRACTION, cap = STAKE_CAP} = {}) {
  const b = odds - 1;
  if (!(b > 0) || !(probability > 0) || !(probability < 1)) return 0;
  const full = (probability * b - (1 - probability)) / b;
  if (!(full > 0)) return 0;
  return Math.min(cap, full * fraction);
}

/**
 * Everything the value check shows for one selection: the forecast's chance (percent in,
 * fraction out), fair odds, the price's implied chance, expected value and a stake. `edge` is
 * the forecast chance minus the implied chance, in percentage points.
 */
export function valueCheck(probabilityPercent, odds, {bankroll = DEFAULT_BANKROLL} = {}) {
  const p = Number(probabilityPercent) / 100;
  if (!(p > 0) || !(p <= 1) || !(odds > 1)) return null;
  const fair = 1 / p;
  const implied = impliedProbability(odds);
  const ev = expectedValue(p, odds);
  const stakeFraction = kellyStake(p, odds);
  return {
    probability: p,
    fairOdds: round(fair, 2),
    odds,
    impliedProbability: implied,
    edge: round((p - implied) * 100, 1),
    expectedValue: round(ev, 4),
    expectedValuePercent: round(ev * 100, 1),
    value: ev > 0,
    stakeFraction: round(stakeFraction, 4),
    stake: round(bankroll * stakeFraction, 2),
    bankroll,
  };
}

/**
 * An accumulator of independent selections: the chance every leg wins, the fair price for the
 * whole slip, "one in N", and (with the bookmaker's combined price) the expected value.
 * Probabilities in percent. Legs without a usable chance are left out and counted.
 */
export function slipSummary(probabilitiesPercent, combinedOdds = null) {
  const legs = (Array.isArray(probabilitiesPercent) ? probabilitiesPercent : [])
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0 && v <= 100);
  const skipped = (probabilitiesPercent?.length ?? 0) - legs.length;
  if (!legs.length) return {legs: 0, skipped, probability: null};
  const probability = legs.reduce((acc, v) => acc * (v / 100), 1);
  const out = {
    legs: legs.length,
    skipped,
    probability: round(probability, 6),
    probabilityPercent: round(probability * 100, probability < 0.01 ? 2 : 1),
    fairOdds: round(1 / probability, 2),
    oneIn: Math.round(1 / probability),
  };
  if (combinedOdds > 1) {
    const ev = expectedValue(probability, combinedOdds);
    Object.assign(out, {
      combinedOdds,
      expectedValuePercent: round(ev * 100, 1),
      value: ev > 0,
      impliedProbabilityPercent: round((1 / combinedOdds) * 100, 2),
    });
  }
  return out;
}
