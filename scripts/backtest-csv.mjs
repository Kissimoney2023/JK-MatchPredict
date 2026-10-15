// Backtests the forecast model on free historical results from football-data.co.uk, which also
// carry bookmaker closing odds. No API key needed.
//
//   node scripts/backtest-csv.mjs --league E0                 (E0 = Premier League)
//   node scripts/backtest-csv.mjs --league E0,SP1,D1,I1,F1    (also La Liga, Bundesliga, ...)
//
// Method (honest by construction):
//  - Every match is predicted only from results played BEFORE it (rolling refit, weekly), and a
//    model sees only about the last year of results, as in production.
//  - Settings are chosen on a validation period (2024/25) and judged on a later holdout period
//    (2025/26 onwards) the tuning never saw.
//  - Models are compared on the same matches: the ratings model (jk-ratings-v2), the old
//    goal-average model, a frequency prior, and the bookmakers' closing line (Pinnacle, with the
//    margin removed), which is the toughest public benchmark.
//
// Lower log loss and Brier are better. Data: https://www.football-data.co.uk/data.php
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {backtest, scoreOne} from '../server/evaluation.mjs';
import {devigShin} from '../server/strikerapi.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i < 0 ? fallback : (args[i + 1] ?? true);
};
const leagues = String(flag('league', 'E0'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const firstSeason = String(flag('from', '2122'));
const lastSeason = String(flag('to', '2627'));
const VALIDATION = {from: Date.UTC(2024, 7, 1), to: Date.UTC(2025, 5, 30, 23)};
const HOLDOUT = {from: Date.UTC(2025, 7, 1), to: Date.UTC(2100, 0, 1)};
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);

const LEAGUE_NAMES = {
  E0: 'Premier League',
  E1: 'Championship',
  SP1: 'La Liga',
  D1: 'Bundesliga',
  I1: 'Serie A',
  F1: 'Ligue 1',
};

// ---------- data ----------
function seasons() {
  const out = [];
  for (let y = Number(firstSeason.slice(0, 2)); y <= Number(lastSeason.slice(0, 2)); y++)
    out.push(String(y).padStart(2, '0') + String(y + 1).padStart(2, '0'));
  return out;
}

async function download(league, season) {
  const cache = `.cache/csv/${league}_${season}.csv`;
  try {
    return await readFile(cache, 'utf8');
  } catch {}
  const response = await fetch(`https://www.football-data.co.uk/mmz4281/${season}/${league}.csv`);
  if (!response.ok) return null;
  const text = await response.text();
  if (!text.includes('HomeTeam')) return null;
  await mkdir('.cache/csv', {recursive: true});
  await writeFile(cache, text);
  return text;
}

function parseCsv(input) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === NL) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== CR) field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function kickoff(dateText, timeText) {
  const [d, m, y] = dateText.split('/').map(Number);
  if (!d || !m || !y) return null;
  const [hh, mm] = (timeText || '12:00').split(':').map(Number);
  return Date.UTC(y < 100 ? 2000 + y : y, m - 1, d, hh || 12, mm || 0);
}

/** Bookmaker line as three fractions: Pinnacle closing, else average closing, else Bet365 closing. */
function marketOf(get) {
  for (const [h, d, a] of [
    ['PSCH', 'PSCD', 'PSCA'],
    ['AvgCH', 'AvgCD', 'AvgCA'],
    ['B365CH', 'B365CD', 'B365CA'],
  ]) {
    const odds = [get(h), get(d), get(a)].map(Number);
    if (odds.every((o) => Number.isFinite(o) && o > 1)) return devigShin(odds.map((o) => 1 / o));
  }
  return null;
}

async function load(league) {
  const ids = new Map();
  const results = [];
  for (const season of seasons()) {
    const text = await download(league, season);
    if (!text) continue;
    const [header, ...rows] = parseCsv(text);
    const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
    for (const r of rows) {
      const get = (name) => (col[name] === undefined ? undefined : r[col[name]]);
      const t = kickoff(get('Date') ?? '', get('Time'));
      const hg = Number(get('FTHG'));
      const ag = Number(get('FTAG'));
      const home = get('HomeTeam');
      const away = get('AwayTeam');
      if (
        !t ||
        !home ||
        !away ||
        get('FTHG') === '' ||
        !Number.isInteger(hg) ||
        !Number.isInteger(ag)
      )
        continue;
      for (const name of [home, away]) if (!ids.has(name)) ids.set(name, ids.size + 1);
      results.push({t, home: ids.get(home), away: ids.get(away), hg, ag, market: marketOf(get)});
    }
  }
  return results.sort((a, b) => a.t - b.t);
}

// ---------- reporting ----------
const f3 = (x) => x.toFixed(3);
const pct = (x) => (x * 100).toFixed(1) + '%';

function table(report) {
  const names = Object.keys(report.models);
  console.log('model      matches  accuracy  log loss   brier');
  for (const name of names) {
    const m = report.models[name];
    console.log(
      `${name.padEnd(10)} ${String(m.n).padStart(7)}  ${pct(m.accuracy).padStart(8)}  ${f3(m.logLoss).padStart(8)}  ${f3(m.brier).padStart(6)}`,
    );
  }
}

/** Paired difference in log loss (a minus b) per match: mean and standard error. */
function paired(report, a, b) {
  const pa = report.predictions[a];
  const pb = report.predictions[b];
  const diffs = pa.map(
    (x, i) => scoreOne(x.p, x.outcome).logLoss - scoreOne(pb[i].p, pb[i].outcome).logLoss,
  );
  const n = diffs.length;
  const mean = diffs.reduce((s, v) => s + v, 0) / n;
  const variance = diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return {n, mean, se: Math.sqrt(variance / n)};
}

function calibration(report, name) {
  return report.models[name].calibration;
}

/** Average predicted chance versus how often it happened, for home / draw / away. */
function outcomeBias(report, name) {
  const preds = report.predictions[name];
  return ['Home', 'Draw', 'Away'].map((label, k) => ({
    label,
    predicted: preds.reduce((s, x) => s + x.p[k], 0) / preds.length,
    observed: preds.filter((x) => x.outcome === k).length / preds.length,
  }));
}

function run(results, period, options) {
  return backtest(results, {
    testFrom: period.from,
    testTo: period.to,
    refitDays: 7,
    keepPredictions: true,
    options,
  });
}

// ---------- main ----------
const GRID = {halfLifeDays: [60, 120, 180, 365, 730], ridge: [1, 2, 4, 8, 16]};

for (const league of leagues) {
  const results = await load(league);
  console.log('='.repeat(78));
  console.log(
    `${LEAGUE_NAMES[league] ?? league}: ${results.length} matches loaded (${firstSeason}–${lastSeason})`,
  );
  const withMarket = results.filter((r) => r.market).length;
  console.log(`bookmaker closing line available for ${withMarket} of them`);
  if (results.length < 500) {
    console.log('Not enough data; skipping.');
    continue;
  }

  // 1. Choose settings on the validation period only.
  const tuning = [];
  for (const halfLifeDays of GRID.halfLifeDays)
    for (const ridge of GRID.ridge) {
      const r = backtest(results, {
        testFrom: VALIDATION.from,
        testTo: VALIDATION.to,
        options: {halfLifeDays, ridge},
      });
      tuning.push({halfLifeDays, ridge, n: r.matches, logLoss: r.models.ratings.logLoss});
    }
  tuning.sort((a, b) => a.logLoss - b.logLoss);
  const best = tuning[0];
  console.log(
    `\nSettings chosen on validation 2024/25 (${best.n} matches): half-life ${best.halfLifeDays} days, shrinkage ${best.ridge}  (log loss ${f3(best.logLoss)})`,
  );
  console.log(
    'Top 3 on validation:',
    tuning
      .slice(0, 3)
      .map((t) => `${t.halfLifeDays}d/${t.ridge}=${f3(t.logLoss)}`)
      .join('  '),
  );

  // 2. Judge on the holdout the tuning never saw.
  const holdoutDefault = run(results, HOLDOUT, {});
  const holdoutTuned = run(results, HOLDOUT, {halfLifeDays: best.halfLifeDays, ridge: best.ridge});
  console.log(`\nHOLDOUT 2025/26 onwards, current production settings (180 days, shrinkage 4):`);
  table(holdoutDefault);
  console.log(`\nHOLDOUT, tuned settings (${best.halfLifeDays} days, shrinkage ${best.ridge}):`);
  table(holdoutTuned);

  const vsMarket = paired(holdoutDefault, 'ratings', 'market');
  const vsLegacy = paired(holdoutDefault, 'ratings', 'legacy');
  const vsPrior = paired(holdoutDefault, 'ratings', 'prior');
  const describe = (label, d) =>
    console.log(
      `  ratings minus ${label}: ${d.mean >= 0 ? '+' : ''}${f3(d.mean)} log loss per match (±${f3(1.96 * d.se)}, 95%) over ${d.n} matches -> ${d.mean + 1.96 * d.se < 0 ? 'ratings clearly better' : d.mean - 1.96 * d.se > 0 ? 'ratings clearly worse' : 'no clear difference'}`,
    );
  console.log('\nPaired comparison on the holdout (negative = ratings model better):');
  describe('market', vsMarket);
  describe('legacy', vsLegacy);
  describe('prior ', vsPrior);

  console.log('');
  console.log('Average predicted chance versus what happened (holdout):');
  const biasRatings = outcomeBias(holdoutDefault, 'ratings');
  const biasMarket = outcomeBias(holdoutDefault, 'market');
  biasRatings.forEach((b, i) =>
    console.log(
      `  ${b.label.padEnd(5)} happened ${pct(b.observed)} | ratings said ${pct(b.predicted)} | market said ${pct(biasMarket[i].predicted)}`,
    ),
  );

  console.log('\nCalibration on the holdout (when a model says X%, how often did it happen?):');
  console.log('  range      ratings: said / happened (n)        market: said / happened (n)');
  const r = calibration(holdoutDefault, 'ratings');
  const m = calibration(holdoutDefault, 'market');
  for (const b of r) {
    const mm = m.find((x) => x.range === b.range);
    console.log(
      `  ${b.range.padEnd(10)} ${pct(b.predicted).padStart(6)} / ${pct(b.observed).padStart(6)} (${String(b.n).padStart(4)})` +
        (mm
          ? `       ${pct(mm.predicted).padStart(6)} / ${pct(mm.observed).padStart(6)} (${String(mm.n).padStart(4)})`
          : ''),
    );
  }
}
