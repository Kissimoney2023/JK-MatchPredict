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
