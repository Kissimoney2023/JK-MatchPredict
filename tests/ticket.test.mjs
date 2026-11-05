import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTicket,
  lines,
  manualLeg,
  MAX_TICKET_LEGS,
  ticketOptions,
} from '../server/ticket.mjs';

const leg = (p, odds, label = 'leg') => ({label, p, odds});
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} vs ${b}`);

test('a ticket is evaluated exactly over every win/lose outcome', () => {
  const two = [leg(50, 2), leg(50, 2)];
  const acc = evaluateTicket(two, lines.accumulator(2));
  close(acc.payProbability, 0.25, 'both must win');
  close(acc.profitProbability, 0.25);
  close(acc.expectedReturn, 1, 'fair odds return the stake on average');
  close(acc.maxReturn, 4);
  assert.equal(acc.oneIn, 4);
  // Two singles with half the stake each: a payout three times in four, a profit one in four.
  const singles = evaluateTicket(two, lines.split(2, 1));
  close(singles.payProbability, 0.75);
  close(singles.profitProbability, 0.25, 'one winner only returns the stake');
  close(singles.expectedReturn, 1);
  close(singles.maxReturn, 2);
  // A "2 of 3" system: three lines, a payout whenever two legs win.
  const three = [leg(50, 2), leg(50, 2), leg(50, 2)];
  const sys = evaluateTicket(three, lines.system(3, 2));
  assert.equal(lines.system(3, 2).length, 3);
  close(sys.payProbability, 0.5);
  close(sys.expectedReturn, 1);
  close(sys.maxReturn, 4);
  // Unequal legs: dropping the weakest leaves the strongest two.
  const mixed = [leg(70, 1.4, 'c'), leg(90, 1.1, 'a'), leg(80, 1.25, 'b')];
  const strong = evaluateTicket(mixed, lines.dropWeakest(mixed, 1));
  close(strong.payProbability, 0.72);
  close(strong.maxReturn, 1.1 * 1.25);
});

test('the options compare one Kombi, splits, systems and trimmed tickets, with one recommended', () => {
  const nine = [93, 88, 85, 80, 75, 70, 62, 55, 50].map((p, i) =>
    leg(p, Math.round((100 / p / 1.05) * 100) / 100, 'L' + i),
  );
  const opts = ticketOptions(nine, {stake: 5});
  assert.equal(opts[0].id, 'accumulator');
  assert.equal(opts[0].linesCount, 1);
  assert.ok(opts[0].payProbability < 0.1, `nine legs rarely all win: ${opts[0].payProbability}`);
  for (const id of ['split-3', 'system-8', 'system-7', 'drop-1', 'drop-2'])
    assert.ok(
      opts.some((o) => o.id === id),
      id,
    );
  const sys7 = opts.find((o) => o.id === 'system-7');
  assert.equal(sys7.linesCount, 36);
  assert.equal(sys7.stakePerLine, Math.round((5 / 36) * 100) / 100, 'stake per line in cents');
  assert.ok(
    sys7.payProbability > opts[0].payProbability * 3,
    'a 7-of-9 system pays far more often',
  );
  assert.ok(sys7.maxReturn < opts[0].maxReturn, 'and pays less at best');
  for (const o of opts) {
    assert.ok(o.payProbability >= 0 && o.payProbability <= 1, o.id);
    assert.ok(o.expectedReturn > 0.5 && o.expectedReturn < 1.1, `${o.id} ${o.expectedReturn}`);
    assert.ok(
      o.expectedReturn >= opts[0].expectedReturn - 1e-9,
      'shorter lines lose no more margin than the long Kombi',
    );
    assert.equal(typeof o.title, 'string');
  }
  assert.equal(opts.filter((o) => o.recommended).length, 1, 'exactly one recommendation');
  assert.ok(!opts[0].recommended, 'nine legs in one Kombi is never the recommendation');
  // Short tickets offer nothing to split.
  assert.equal(ticketOptions([leg(60, 1.7), leg(55, 1.8)]).length, 1);
  // Too many legs: refused rather than exploding.
  assert.equal(ticketOptions(Array.from({length: MAX_TICKET_LEGS + 1}, () => leg(60, 1.7))), null);
  // Legs without a price are priced at fair odds and say so.
  const fair = ticketOptions([leg(60, null), leg(50, null), leg(70, null)]);
  assert.ok(fair[0].fairPriced);
});

test('a leg typed in by hand takes its chance from the price, with the margin removed', () => {
  const l = manualLeg({label: 'Reims win', odds: '2.00'});
  assert.equal(l.odds, 2);
  assert.equal(l.p, 47.6);
  assert.equal(l.label, 'Reims win');
  assert.equal(manualLeg({label: 'x', odds: 'abc'}), null);
  assert.equal(manualLeg({label: '', odds: '2'}), null);
});

test('the slip shows the ticket options and takes legs by hand', async () => {
  const {slipHtml} = await import('../public/js/views/slip.js');
  const pick = (id, home, prob) => ({
    id,
    outcome: 0,
    forecast: {home, away: 'B', p: [prob, 100 - prob - 10, 10], kickoff: '2099-01-01T00:00:00Z'},
  });
  const picks = [pick('a', 'A', 80), pick('b', 'B', 70), pick('c', 'C', 60)];
  const html = slipHtml(picks, '', {
    legOdds: {a: '1.25', b: '1.45', c: '1.70'},
    manual: [{label: 'Reims win', odds: 1.57, p: 60.7}],
    stake: '5',
  });
  assert.match(html, /Build my ticket/);
  assert.match(html, /Recommended/);
  assert.match(html, /System 3 of 4|3 of 4/);
  assert.match(html, /Reims win/);
  assert.match(html, /data-manual-remove="0"/);
  assert.match(html, /id="manual-label"/);
  assert.match(html, /id="slip-stake"[^>]*value="5"/);
  // Two legs: the builder has nothing to say yet, but still invites more legs.
  assert.doesNotMatch(slipHtml(picks.slice(0, 2), ''), /Recommended/);
});
