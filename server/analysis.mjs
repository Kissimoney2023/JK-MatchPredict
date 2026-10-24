export function analyze(f) {
  const labels = [f.home, 'Draw', f.away],
    order = [0, 1, 2].sort((a, b) => f.p[b] - f.p[a]);
  const market = String(f.modelVersion || '').startsWith('market');
  const n = order[0],
    top = f.p[n],
    margin = top - f.p[order[1]],
    tie = margin < 0.1;
  const doubles = [
    {label: `${f.home} or draw (1X)`, p: f.p[0] + f.p[1]},
    {label: `Draw or ${f.away} (X2)`, p: f.p[1] + f.p[2]},
    {label: 'Either team wins (12)', p: f.p[0] + f.p[2]},
  ].sort((a, b) => b.p - a.p);
  const tips = [
    {
      market: '90-minute result',
      selection: tie ? 'No clear favorite' : n === 1 ? 'Draw' : `${labels[n]} win`,
      probability: top,
      note:
        margin < 8
          ? 'The leading outcomes are close; passing is reasonable.'
          : 'The highest estimated probability is still uncertain.',
    },
    {
      market: 'Double chance',
      selection: doubles[0].label,
      probability: Math.round(doubles[0].p * 10) / 10,
      note: 'Covers two outcomes. A higher chance does not imply a profitable price.',
    },
  ];
  if (f.expectedGoals) {
    const [h, a] = f.expectedGoals,
      sum = h + a,
      under = Math.exp(-sum) * (1 + sum + (sum * sum) / 2),
      btts = (1 - Math.exp(-h)) * (1 - Math.exp(-a));
    tips.push(
      {
        market: 'Total goals · model estimate',
        selection: under >= 0.5 ? 'Under 2.5' : 'Over 2.5',
        probability: Math.round(Math.max(under, 1 - under) * 1000) / 10,
        note: 'Derived from the experimental independent-goal model.',
      },
      {
        market: 'Both teams score · model estimate',
        selection: btts >= 0.5 ? 'Yes' : 'No',
        probability: Math.round(Math.max(btts, 1 - btts) * 1000) / 10,
        note: 'This model does not account for lineups or player availability.',
      },
    );
  }
  return {
    outcomeIndex: n,
    predictedOutcome: tie ? 'No clear favorite' : n === 1 ? 'Draw' : `${labels[n]} win`,
    predictedWinner: tie || n === 1 ? 'No clear winning team' : labels[n],
    probability: top,
    margin: Math.round(margin * 10) / 10,
    strength:
      margin < 8 || top < 45
        ? 'Low separation'
        : top >= 60
          ? 'Stronger favorite'
          : 'Moderate favorite',
    tips,
    goals: f.goals ?? (f.expectedGoals ? goalMarkets(f.expectedGoals) : null),
    verdict:
      margin < 8 || top < 45
        ? 'Consider skipping this match: the forecast does not separate the outcomes strongly.'
        : market
          ? 'The market’s view with the margin removed. There is no edge over the bookmakers in it.'
          : 'A probability-based lean only. Compare offered odds before assessing value.',
    disclaimer: market
      ? 'These probabilities come from bookmaker prices, so these tips carry no edge or expected profit. Predictions cover 90 minutes plus stoppage time.'
      : 'No bookmaker odds are connected, so these tips do not establish value or expected profit. Predictions cover 90 minutes plus stoppage time.',
  };
}

/**
 * Over/Under probabilities (percent) for the usual goal lines and both-teams-to-score, from the
 * model's expected goals under independent Poisson scoring. Estimates, not bookmaker prices.
 */
export function goalMarkets([home, away]) {
  const total = home + away;
  const pct = (p) => Math.round(Math.min(1, Math.max(0, p)) * 1000) / 10;
  let term = Math.exp(-total); // P(total goals = k), starting at k = 0
  let upTo = 0; // P(total goals <= k)
  const lines = [];
  for (let k = 0; k <= 3; k++) {
    upTo += term;
    lines.push({line: k + 0.5, over: pct(1 - upTo), under: pct(upTo)});
    term = (term * total) / (k + 1);
  }
  return {lines, btts: pct((1 - Math.exp(-home)) * (1 - Math.exp(-away)))};
}

/**
 * Fair decimal odds for a probability in percent: 1 ÷ probability, with no bookmaker margin.
 * A price below this offers no value by that forecast; a price above it would. Null for 0%.
 */
export const fairOdds = (percent) =>
  Number.isFinite(percent) && percent > 0 ? Math.round((100 / percent) * 100) / 100 : null;

const TIERS = [
  {min: 85, label: 'very likely'},
  {min: 70, label: 'likely'},
  {min: 55, label: 'lean'},
  {min: 0, label: 'toss-up'},
];
export const tierOf = (percent) => TIERS.find((t) => percent >= t.min).label;

/**
 * Every selection the forecast prices, ranked by chance: the three results, double chance,
 * draw no bet (from the level handicap line when scores are available), Over/Under lines
 * and both teams to score. Each carries its chance (percent), fair odds and a tier. A short
 * list of what is most likely in the match, not a list of bets: the surer the selection, the
 * shorter its price, and a slip still multiplies the misses.
 */
export function likelySelections(f, {limit = 8} = {}) {
  if (!Array.isArray(f?.p) || f.p.length !== 3) return [];
  const [h, d, a] = f.p;
  const items = [
    {market: 'Result', selection: `${f.home} win`, p: h},
    {market: 'Result', selection: 'Draw', p: d},
    {market: 'Result', selection: `${f.away} win`, p: a},
    {market: 'Double chance', selection: `${f.home} or draw (1X)`, p: h + d},
    {market: 'Double chance', selection: `Draw or ${f.away} (X2)`, p: d + a},
    {market: 'Double chance', selection: 'Either team wins (12)', p: h + a},
  ];
  const level = f.scores?.handicaps?.find((x) => x.line === 0);
  if (level && level.push < 100) {
    const live = 100 - level.push;
    items.push({
      market: 'Draw no bet',
      selection: `${f.home} (stake back on a draw)`,
      p: (level.home / live) * 100,
    });
    items.push({
      market: 'Draw no bet',
      selection: `${f.away} (stake back on a draw)`,
      p: (level.away / live) * 100,
    });
  }
  for (const l of f.goals?.lines ?? []) {
    items.push({market: 'Goals', selection: `Over ${l.line}`, p: l.over});
    items.push({market: 'Goals', selection: `Under ${l.line}`, p: l.under});
  }
  if (Number.isFinite(f.goals?.btts)) {
    items.push({market: 'Both teams score', selection: 'Yes', p: f.goals.btts});
    items.push({market: 'Both teams score', selection: 'No', p: 100 - f.goals.btts});
  }
  return items
    .filter((x) => Number.isFinite(x.p) && x.p > 0 && x.p < 100)
    .map((x) => {
      const p = Math.round(x.p * 10) / 10;
      return {...x, p, fairOdds: fairOdds(p), tier: tierOf(p)};
    })
    .sort((x, y) => y.p - x.p)
    .slice(0, limit);
}
