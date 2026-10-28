import test from 'node:test';
import assert from 'node:assert/strict';
import {isPickableSelection, selectionOutcome} from '../server/scores.mjs';
import {fdSettlementRaw, halfTimeScore, settleSelection} from '../server/model.mjs';
import {
  pickKind,
  pickLabel,
  pickPrice,
  pickProbability,
  slipsSummary,
  summarizePicks,
} from '../server/pickstats.mjs';
import {createService} from '../server/service.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';

const full = (home, away) => ({home, away});

test('a selection id settles against the full-time and half-time scores', () => {
  assert.equal(selectionOutcome('fh:total:over:0.5', full(0, 1), full(0, 0)), false);
  assert.equal(selectionOutcome('fh:total:over:0.5', full(2, 1), full(1, 0)), true);
  assert.equal(selectionOutcome('fh:total:under:1.5', full(2, 1), full(1, 0)), true);
  assert.equal(selectionOutcome('fh:result:1', full(2, 1), full(1, 1)), true);
  assert.equal(selectionOutcome('fh:btts:yes', full(2, 1), full(1, 1)), true);
  assert.equal(selectionOutcome('htft:1:0', full(2, 1), full(1, 1)), true, 'X/1');
  assert.equal(selectionOutcome('htft:0:0', full(2, 1), full(1, 1)), false);
  assert.equal(selectionOutcome('dc:1X', full(1, 1)), true);
  assert.equal(selectionOutcome('hcap:0:1:X', full(1, 0)), true, 'a one-goal home win is X at 0:1');
  assert.equal(selectionOutcome('hcap:0:1:1', full(2, 0)), true);
  assert.equal(selectionOutcome('score:1:1', full(1, 1)), true);
  assert.equal(selectionOutcome('btts:no', full(2, 0)), true);
  assert.equal(selectionOutcome('fh:total:over:0.5', full(2, 1), null), null, 'needs the half');
  assert.equal(selectionOutcome('first:0', full(2, 1), full(1, 0)), null, 'first goal is unknown');
  assert.equal(selectionOutcome('nonsense', full(2, 1)), null);
  assert.ok(isPickableSelection('fh:total:over:0.5'));
  assert.ok(isPickableSelection('htft:2:2'));
  assert.ok(!isPickableSelection('first:0'));
  assert.ok(!isPickableSelection('x'));
});

test('selection picks settle from the provider’s half-time score, and are void without one', () => {
  const raw = (status, fulltime, halftime) => ({
    fixture: {status: {short: status}},
    score: {fulltime, halftime},
  });
  const pick = {market: 'selection', selection: 'fh:total:over:0.5', outcome: 0};
  assert.deepEqual(halfTimeScore(raw('FT', full(0, 1), full(0, 0))), full(0, 0));
  assert.equal(halfTimeScore(raw('FT', full(0, 1), {})), null);
  const lost = settleSelection(raw('FT', full(0, 1), full(0, 0)), pick);
  assert.equal(lost.result, 'incorrect');
  assert.equal(lost.score, '0–1 (HT 0–0)');
  assert.equal(settleSelection(raw('FT', full(2, 1), full(1, 0)), pick).result, 'correct');
  assert.equal(settleSelection(raw('2H', full(1, 0), full(1, 0)), pick), null, 'still playing');
  assert.equal(
    settleSelection(raw('FT', full(2, 1), {}), pick).result,
    'void',
    'a finished match without a half-time score cannot settle a first-half pick',
  );
  assert.equal(
    settleSelection(raw('FT', full(2, 1), {}), {market: 'selection', selection: 'dc:1X'}).result,
    'correct',
    'full-time selections do not need the half',
  );
  assert.equal(settleSelection(raw('CANC', {}, {}), pick).result, 'void');
  // football-data.org carries the half-time score under another name.
  const fd = fdSettlementRaw({
    status: 'FINISHED',
    score: {duration: 'REGULAR', fullTime: full(2, 1), halfTime: full(1, 0)},
  });
  assert.deepEqual(fd.score.halftime, full(1, 0));
});

const forecast = {
  home: 'Sevilla',
  away: 'Osasuna',
  p: [52.4, 27, 20.6],
  kickoff: '2026-10-26T20:00:00Z',
  competition: 'La Liga',
};
const sel = (selection, probability, extra = {}) => ({
  id: selection,
  market: 'selection',
  selection,
  outcome: 0,
  probability,
  forecast,
  ...extra,
});

test('selection picks have labels, kinds, chances and prices', () => {
  assert.equal(pickLabel(sel('fh:total:over:0.5', 64)), 'Over 0.5 goals · 1st half');
  assert.equal(pickLabel(sel('hcap:0:1:X', 23)), 'Handicap 0:1 · Draw');
  assert.equal(pickLabel(sel('hcap:0:1:2', 47.6)), 'Handicap 0:1 · Osasuna');
  assert.equal(pickLabel(sel('htft:1:0', 17.8)), 'Half-time/full-time X/1');
  assert.equal(pickLabel(sel('dc:1X', 79.4)), 'Sevilla or draw (1X)');
  assert.equal(pickLabel(sel('btts:yes', 52.7)), 'Both teams score: Yes');
  assert.equal(pickLabel(sel('score:1:1', 10.2)), 'Correct score 1:1');
  assert.equal(pickLabel(sel('fh:result:0', 40)), 'Sevilla wins the 1st half');
  assert.equal(pickLabel(sel('total:under:3.5', 71.8)), 'Under 3.5 goals');
  assert.equal(pickKind(sel('fh:total:over:0.5', 64)), '1st half');
  assert.equal(pickKind(sel('hcap:0:1:X', 23)), 'Handicap');
  assert.equal(pickKind(sel('dc:1X', 79.4)), 'Double chance');
  assert.equal(pickKind(sel('total:over:2.5', 50)), 'Over 2.5');
  assert.equal(pickProbability(sel('fh:total:over:0.5', 64.2)), 64.2);
  assert.equal(pickPrice(sel('fh:total:over:0.5', 64.2, {price: 1.32})), 1.32);
  assert.equal(pickPrice({outcome: 0, forecast}), null);
  // The statistics count them like any other pick.
  const s = summarizePicks([
    sel('fh:total:over:0.5', 64, {result: 'incorrect'}),
    {outcome: 0, forecast, result: 'correct'},
  ]);
  assert.equal(s.settled, 2);
  assert.ok(s.byOutcome.some((o) => o.label === '1st half' && o.settled === 1));
});

test('slips group the picks placed together and settle as a whole', () => {
  const won = (selection, p, price) =>
    sel(selection, p, {price, slip: 'Mon 26 Oct', result: 'correct'});
  const picks = [
    won('result:0', 79.4, 1.26),
    won('result:0', 75.8, 1.32),
    sel('fh:total:over:0.5', 64, {
      price: 1.32,
      slip: 'Mon 26 Oct',
      result: 'incorrect',
      score: '0–1 (HT 0–0)',
    }),
    sel('result:2', 58.8, {price: 1.7, slip: 'Mon 26 Oct', result: 'correct'}),
    sel('result:0', 60, {price: 1.5, slip: 'Sat 31 Oct'}), // pending
    sel('result:0', 55, {price: 1.8, slip: 'Sat 31 Oct', result: 'void'}),
    sel('result:1', 30, {}), // no slip: a single
  ];
  const s = slipsSummary(picks);
  assert.equal(s.slips.length, 2);
  const mon = s.slips.find((x) => x.label === 'Mon 26 Oct');
  assert.equal(mon.n, 4);
  assert.equal(mon.status, 'lost');
  assert.equal(mon.correct, 3);
  assert.equal(mon.incorrect, 1);
  assert.equal(mon.price, Math.round(1.26 * 1.32 * 1.32 * 1.7 * 100) / 100);
  assert.ok(mon.probability > 0 && mon.probability < 100);
  assert.equal(mon.fairOdds, Math.round((100 / mon.probability) * 100) / 100);
  assert.deepEqual(
    mon.lostLegs.map((p) => p.selection),
    ['fh:total:over:0.5'],
  );
  const sat = s.slips.find((x) => x.label === 'Sat 31 Oct');
  assert.equal(sat.status, 'pending');
  assert.equal(sat.price, 1.5, 'void legs drop out of the price');
  assert.equal(s.won, 0);
  assert.equal(s.lost, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.legsSettled, 4);
  assert.equal(s.legsCorrect, 3);
  assert.deepEqual(slipsSummary([]), {
    slips: [],
    won: 0,
    lost: 0,
    pending: 0,
    legsSettled: 0,
    legsCorrect: 0,
  });
});

test('the combination panel prices legs, names the slip and offers to save the picks', async () => {
  const {comboPanelForTest} = await import('../public/js/views/markets.js');
  const {buildMatrix, outcomeProbabilities, scoreMarkets} = await import('../server/scores.mjs');
  const m = buildMatrix(1.5, 1.0, -0.05);
  const f = {
    ...forecast,
    p: outcomeProbabilities(m).map((x) => Math.round(x * 1000) / 10),
    scores: scoreMarkets(m, {rates: [1.5, 1.0], rho: -0.05}),
  };
  const html = comboPanelForTest(f, {
    legs: ['result:1', 'btts:yes'],
    legPrices: {'result:1': '3.50', 'btts:yes': '1.95'},
    slipLabel: '<b>Mon</b>',
    priceText: '5.20',
  });
  assert.match(html, /data-leg-price="result:1"[^>]*value="3.50"/);
  assert.match(html, /id="combo-slip"[^>]*value="&lt;b&gt;Mon&lt;\/b&gt;"/);
  assert.match(html, /data-save-picks/);
  assert.match(html, /Save 2 picks/);
  assert.match(html, /Not worth it|Worth it/);
  const {slipsBlockForTest} = await import('../public/js/views/slips.js');
  const block = slipsBlockForTest([
    sel('result:0', 79.4, {price: 1.26, slip: '<i>x</i>', result: 'correct'}),
    sel('fh:total:over:0.5', 64, {
      price: 1.32,
      slip: '<i>x</i>',
      result: 'incorrect',
      score: '0–1 (HT 0–0)',
    }),
  ]);
  assert.ok(!block.includes('<i>x</i>'));
  assert.match(block, /Lost/);
  assert.match(block, /1st half/);
  assert.equal(slipsBlockForTest([{outcome: 0, forecast}]), '');
});

test('a selection pick is saved with its chance, price and slip, and settles from the half-time score', async () => {
  const kickoff = Date.parse('2026-10-26T20:00:00Z');
  let clock = kickoff - 5 * 3_600_000;
  let finished = null; // {fulltime, halftime} once the match is over
  const fetcher = async (url) => {
    const u = new URL(url);
    if (u.hostname.includes('api-sports')) {
      const response =
        u.pathname === '/leagues'
          ? [
              {
                league: {id: 140, name: 'La Liga', type: 'League'},
                country: {name: 'Spain'},
                seasons: [{current: true, year: 2026, coverage: {predictions: true}}],
              },
            ]
          : u.pathname === '/predictions'
            ? [{predictions: {percent: {home: '55%', draw: '25%', away: '20%'}}}]
            : [
                {
                  fixture: {
                    id: 7,
                    date: new Date(kickoff).toISOString(),
                    status: {short: finished ? 'FT' : 'NS'},
                  },
                  league: {id: 140, name: 'La Liga', season: 2026},
                  teams: {home: {name: 'Sevilla'}, away: {name: 'Osasuna'}},
                  goals: finished?.fulltime ?? {},
                  score: finished ?? {fulltime: {}},
                },
              ];
      return Response.json({response, errors: [], paging: {total: 1}});
    }
    if (u.pathname.includes('get_schedule'))
      return Response.json({
        data: {
          games: [
            {
              game_id: 'g1',
              starts_at: new Date(kickoff).toISOString(),
              home: {name: 'Sevilla'},
              away: {name: 'Osasuna'},
              line: {home_ml: -125, draw_ml: +250, away_ml: +380, total: 2.5},
            },
          ],
        },
      });
    return Response.json({data: {}});
  };
  const service = createService({
    env: {API_FOOTBALL_KEY: 'ap-test', STRIKERAPI_API_KEY: 'sa-test'},
    store: createMemoryStore(),
    fetcher,
    now: () => clock,
  });
  const list = await service.fixtures(new URLSearchParams({from: '2026-10-26', league: 'ap:140'}));
  const f = await service.forecast('ap:7', list.listingId);
  const saved = await service.save(
    f.key === 'ap:7' && 'sid1',
    f.forecastId,
    0,
    'selection',
    undefined,
    {
      selection: 'fh:total:over:0.5',
      price: '1.32',
      slip: '  Mon 26 Oct  ',
    },
  );
  assert.equal(saved.saved, true);
  const again = await service.save('sid1', f.forecastId, 0, 'selection', undefined, {
    selection: 'fh:total:over:0.5',
  });
  assert.equal(again.saved, false, 'one pick per match per selection');
  await service.save('sid1', f.forecastId, 0, 'selection', undefined, {
    selection: 'dc:1X',
    price: '1.16',
    slip: 'Mon 26 Oct',
  });
  await service.save('sid1', f.forecastId, 0, 'result', undefined, {
    price: '1.80',
    slip: 'Mon 26 Oct',
  });
  await assert.rejects(
    service.save('sid1', f.forecastId, 0, 'selection', undefined, {selection: 'first:0'}),
    /cannot be settled|Invalid/,
  );
  await assert.rejects(
    service.save('sid1', f.forecastId, 0, 'selection', undefined, {
      selection: 'dc:X2',
      price: 'abc',
    }),
    /price/i,
  );
  const picks = await service.picks('sid1');
  assert.equal(picks.length, 3);
  const fh = picks.find((p) => p.selection === 'fh:total:over:0.5');
  assert.equal(fh.market, 'selection');
  assert.ok(fh.probability > 50 && fh.probability < 75, `chance recorded: ${fh.probability}`);
  assert.equal(fh.price, 1.32);
  assert.equal(fh.slip, 'Mon 26 Oct');
  assert.equal(
    picks.find((p) => p.market !== 'selection').price,
    1.8,
    'result picks take a price too',
  );

  // The match ends 0–1 with a goalless first half.
  finished = {fulltime: {home: 0, away: 1}, halftime: {home: 0, away: 0}};
  clock = kickoff + 3 * 3_600_000;
  const settled = await service.settlePicks('sid1');
  assert.equal(settled.settled, 3);
  const after = await service.picks('sid1');
  assert.equal(after.find((p) => p.selection === 'fh:total:over:0.5').result, 'incorrect');
  assert.equal(after.find((p) => p.selection === 'fh:total:over:0.5').score, '0–1 (HT 0–0)');
  assert.equal(after.find((p) => p.selection === 'dc:1X').result, 'incorrect');
  assert.equal(after.find((p) => p.market !== 'selection').result, 'incorrect');
  const slips = slipsSummary(after);
  assert.equal(slips.slips[0].status, 'lost');
  assert.equal(slips.slips[0].price, Math.round(1.32 * 1.16 * 1.8 * 100) / 100);
});
