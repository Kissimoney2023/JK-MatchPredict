export const demoLeagues = [
  {key: 'ap:2', name: 'Champions League', country: 'Europe', fdCode: 'CL', featured: true},
  {key: 'ap:39', name: 'Premier League', country: 'England', featured: true},
  {key: 'ap:140', name: 'La Liga', country: 'Spain', featured: true},
];

const SAMPLE_MATCHES = [
  ['Arsenal', 'Inter', 'ap:2', [48, 28, 24]],
  ['Real Madrid', 'Bayern Munich', 'ap:2', [42, 26, 32]],
  ['Liverpool', 'Chelsea', 'ap:39', [55, 25, 20]],
  ['Man City', 'Aston Villa', 'ap:39', [61, 23, 16]],
  ['Barcelona', 'Sevilla', 'ap:140', [63, 22, 15]],
  ['Valencia', 'Villarreal', 'ap:140', [33, 34, 33]],
];

/** Invented fixtures for the explicit demo mode; never real forecasts. */
export function samples() {
  return SAMPLE_MATCHES.map(([home, away, leagueKey, p], i) => ({
    key: 'demo:' + i,
    home,
    away,
    leagueKey,
    competition: demoLeagues.find((l) => l.key === leagueKey).name,
    p,
    kickoff: new Date(Date.now() + (i + 2) * 3600000).toISOString(),
    status: 'NS',
    source: 'Illustrative demo — not a real forecast',
    forecastAt: Date.now(),
    demo: true,
  }));
}
