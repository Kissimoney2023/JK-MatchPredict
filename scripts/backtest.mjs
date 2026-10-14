// Backtests the forecast model on real football-data.org results.
//
//   FOOTBALL_DATA_ORG_KEY=... node scripts/backtest.mjs --competition CL --days 90
//
// Options: --competition CODE (default CL)   --days N test window (default 90)
//          --refit N days between refits (default 7)   --refresh re-download data
//          --tune   grid-search recency half-life and shrinkage
//
// Downloads each team's last-year results once (rate-limited to the free tier) into
// .cache/, then evaluates chronologically: every match is predicted using only results that
// were played before its refit window.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {backtest} from '../server/evaluation.mjs';
import {collectResults} from '../server/ratings.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i < 0 ? fallback : (args[i + 1] ?? true);
};
const code = String(flag('competition', 'CL')).toUpperCase();
const testDays = Number(flag('days', 90));
const refitDays = Number(flag('refit', 7));
const cacheFile = `.cache/backtest-${code}.json`;
const DAY = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  const token = process.env.FOOTBALL_DATA_ORG_KEY;
  if (!token) throw Error('Set FOOTBALL_DATA_ORG_KEY to download data.');
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch('https://api.football-data.org/v4/' + path, {
      headers: {'X-Auth-Token': token},
    });
    if (response.status === 429) {
      await sleep(30_000);
      continue;
    }
    if (!response.ok) throw Error(`HTTP ${response.status} for ${path}: ${await response.text()}`);
    await sleep(6_500); // free tier: 10 requests per minute
    return response.json();
  }
  throw Error('Rate limited repeatedly; try again in a few minutes.');
}

async function loadRows() {
  if (!args.includes('--refresh')) {
    try {
      return JSON.parse(await readFile(cacheFile, 'utf8'));
    } catch {}
  }
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
  const {teams} = await api(`competitions/${code}/teams`);
  console.error(
    `Downloading ${teams.length} team histories (about ${Math.ceil((teams.length * 6.5) / 60)} min)…`,
  );
  const rows = [];
  for (const [i, team] of teams.entries()) {
    const data = await api(
      `teams/${team.id}/matches?status=FINISHED&dateFrom=${from}&dateTo=${to}&limit=100`,
    );
    rows.push(...(data.matches ?? []));
    console.error(`  ${i + 1}/${teams.length} ${team.shortName || team.name}`);
  }
  await mkdir('.cache', {recursive: true});
  await writeFile(cacheFile, JSON.stringify(rows));
  return rows;
}

const pct = (x) => (x * 100).toFixed(1) + '%';
function printReport(report) {
  console.log(
    `\nEvaluated ${report.matches} matches (${report.skipped} skipped: too little data)\n`,
  );
  console.log('model     accuracy  log loss  brier');
  for (const [name, m] of Object.entries(report.models))
    console.log(
      `${name.padEnd(9)} ${pct(m.accuracy).padStart(8)}  ${m.logLoss.toFixed(3).padStart(8)}  ${m.brier.toFixed(3)}`,
    );
  console.log('\nCalibration of the ratings model (predicted vs observed frequency):');
  for (const b of report.models.ratings.calibration)
    console.log(
      `  ${b.range.padEnd(8)} predicted ${pct(b.predicted).padStart(6)}  observed ${pct(b.observed).padStart(6)}  (n=${b.n})`,
    );
  console.log(
    '\nLower log loss and Brier are better. "prior" always predicts the training home/draw/away rates.',
  );
}

const rows = await loadRows().catch((e) => {
  console.error('Backtest failed: ' + e.message);
  process.exit(1);
});
const results = collectResults(rows);
console.log(
  `${results.length} distinct regulation-time results from ${rows.length} downloaded rows.`,
);

if (args.includes('--tune')) {
  const table = [];
  for (const halfLifeDays of [90, 180, 365])
    for (const ridge of [2, 4, 8]) {
      const r = backtest(results, {testDays, refitDays, options: {halfLifeDays, ridge}});
      table.push({halfLifeDays, ridge, n: r.matches, logLoss: r.models.ratings.logLoss});
    }
  table.sort((a, b) => a.logLoss - b.logLoss);
  console.log('\nhalfLife ridge  n    logLoss');
  for (const t of table)
    console.log(
      `${String(t.halfLifeDays).padStart(8)} ${String(t.ridge).padStart(5)} ${String(t.n).padStart(4)}  ${t.logLoss.toFixed(4)}`,
    );
} else {
  printReport(backtest(results, {testDays, refitDays}));
}
