// Ticket shapes for one set of legs: one accumulator, short combinations, system bets and
// trimmed tickets, each evaluated exactly over every win/lose outcome. No imports: this file
// is also published to the browser (as /ticket.js), like value.mjs.
//
// The point is the trade a slip hides: the same legs can be arranged to pay often and little
// or rarely and a lot. Legs are treated as independent (which flatters related legs).

export const MAX_TICKET_LEGS = 12; // 2^12 outcomes is instant; beyond that the builder declines
const MANUAL_MARGIN = 0.05; // a typical single-market overround, removed from a typed price

const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;
const range = (n) => Array.from({length: n}, (_, i) => i);

/** A leg typed in by hand: its chance comes from the price with a typical margin removed. */
export function manualLeg({label, odds}) {
  const name = String(label ?? '').trim();
  const price = Number(
    String(odds ?? '')
      .trim()
      .replace(',', '.'),
  );
  if (!name || !Number.isFinite(price) || price <= 1 || price >= 1000) return null;
  return {
    label: name.slice(0, 60),
    odds: round(price, 2),
    p: round(100 / (price * (1 + MANUAL_MARGIN)), 1),
    manual: true,
  };
}

/** The price a leg is evaluated at: the one given, else fair odds from its chance. */
const oddsOf = (leg) => (Number(leg.odds) > 1 ? Number(leg.odds) : 100 / Number(leg.p));

const combinations = (n, k) => {
  const out = [];
  const pick = (start, chosen) => {
    if (chosen.length === k) return void out.push([...chosen]);
    for (let i = start; i <= n - (k - chosen.length); i++) pick(i + 1, [...chosen, i]);
  };
  pick(0, []);
  return out;
};

/** Line builders: each returns a list of lines, a line being the leg indices it needs. */
export const lines = {
  accumulator: (n) => [range(n)],
  /** Groups of `size`, dealt round-robin so every group mixes strong and weak legs. */
  split: (n, size) => {
    const groups = Math.ceil(n / size);
    const out = Array.from({length: groups}, () => []);
    for (const i of range(n)) out[i % groups].push(i);
    return out;
  },
  /** A "k of n" system: every combination of k legs is its own line. */
  system: (n, k) => combinations(n, k),
  /** One accumulator without the `count` least likely legs. */
  dropWeakest: (legs, count) => [
    range(legs.length)
      .sort((a, b) => Number(legs[b].p) - Number(legs[a].p))
      .slice(0, Math.max(1, legs.length - count))
      .sort((a, b) => a - b),
  ],
};

/**
 * What a ticket does, exactly: the stake split equally over its lines, every outcome of the
 * legs weighted by its probability. Returns are per unit staked. `payProbability` is any
 * money back, `profitProbability` more than the stake back. Null above MAX_TICKET_LEGS.
 */
export function evaluateTicket(legs, ticketLines, {stake = 1} = {}) {
  const n = legs.length;
  if (!n || n > MAX_TICKET_LEGS || !ticketLines?.length) return null;
  const p = legs.map((l) => Math.min(1, Math.max(0, Number(l.p) / 100)));
  const odds = legs.map(oddsOf);
  const perLine = stake / ticketLines.length;
  const prepared = ticketLines.map((line) => ({
    mask: line.reduce((m, i) => m | (1 << i), 0),
    payout: perLine * line.reduce((acc, i) => acc * odds[i], 1),
  }));
  let pay = 0;
  let profit = 0;
  let expected = 0;
  let max = 0;
  for (let mask = 0; mask < 1 << n; mask++) {
    let prob = 1;
    for (let i = 0; i < n && prob > 0; i++) prob *= mask & (1 << i) ? p[i] : 1 - p[i];
    if (prob === 0) continue;
    let ret = 0;
    for (const line of prepared) if ((mask & line.mask) === line.mask) ret += line.payout;
    if (ret > 0) pay += prob;
    if (ret > stake + 1e-9) profit += prob;
    expected += prob * ret;
    if (ret > max) max = ret;
  }
  return {
    linesCount: ticketLines.length,
    stakePerLine: perLine,
    payProbability: pay,
    profitProbability: profit,
    expectedReturn: expected / stake,
    maxReturn: max / stake,
    oneIn: pay > 0 ? Math.round(1 / pay) : null,
    fairPriced: legs.some((l) => !(Number(l.odds) > 1)),
  };
}

const option = (id, title, legs, ticketLines, stake, note = '') => {
  const e = evaluateTicket(legs, ticketLines, {stake});
  return (
    e && {
      id,
      title,
      note,
      ...e,
      maxWin: round(e.maxReturn * stake, 2),
      stakePerLine: round(e.stakePerLine, 2),
    }
  );
};

/**
 * The shapes worth comparing for these legs, the one Kombi first. Legs are sorted by chance
 * so the trimmed tickets drop the least likely ones. The recommendation is the shape that
 * pays a profit most often among those whose average return is within five cents per unit
 * of the best; a long single Kombi almost never is. Null above MAX_TICKET_LEGS.
 */
export function ticketOptions(rawLegs, {stake = 1} = {}) {
  const legs = [...(Array.isArray(rawLegs) ? rawLegs : [])]
    .filter((l) => Number(l?.p) > 0 && Number(l.p) < 100)
    .sort((a, b) => Number(b.p) - Number(a.p));
  const n = legs.length;
  if (!n) return [];
  if (n > MAX_TICKET_LEGS) return null;
  const opts = [
    option(
      'accumulator',
      n === 1 ? 'Single' : `One Kombi of ${n}`,
      legs,
      lines.accumulator(n),
      stake,
    ),
  ];
  if (n < 3) return opts.filter(Boolean);
  if (n >= 6)
    opts.push(
      option(
        'split-3',
        `${Math.ceil(n / 3)} short Kombis of 3`,
        legs,
        lines.split(n, 3),
        stake,
        'strong and weak legs mixed',
      ),
    );
  if (n >= 8 && Math.ceil(n / 4) < Math.ceil(n / 3))
    opts.push(
      option(
        'split-4',
        `${Math.ceil(n / 4)} short Kombis of 4`,
        legs,
        lines.split(n, 4),
        stake,
        'strong and weak legs mixed',
      ),
    );
  opts.push(
    option(
      `system-${n - 1}`,
      `System ${n - 1} of ${n}`,
      legs,
      lines.system(n, n - 1),
      stake,
      'one leg may lose',
    ),
  );
  if (n >= 5)
    opts.push(
      option(
        `system-${n - 2}`,
        `System ${n - 2} of ${n}`,
        legs,
        lines.system(n, n - 2),
        stake,
        'two legs may lose',
      ),
    );
  if (n >= 4)
    opts.push(
      option(
        'drop-1',
        `Kombi without the weakest leg (${legs[n - 1].label})`,
        legs,
        lines.dropWeakest(legs, 1),
        stake,
      ),
    );
  if (n >= 5)
    opts.push(
      option(
        'drop-2',
        `Kombi without the two weakest (${legs[n - 2].label}, ${legs[n - 1].label})`,
        legs,
        lines.dropWeakest(legs, 2),
        stake,
      ),
    );
  const all = opts.filter(Boolean);
  const best = Math.max(...all.map((o) => o.expectedReturn));
  const eligible = all.filter((o) => o.expectedReturn >= best - 0.05);
  const top = eligible.reduce((a, b) => (b.profitProbability > a.profitProbability ? b : a));
  return all.map((o) => ({...o, recommended: o === top}));
}

/**
 * The lines of a shape by its option id ("accumulator", "split-3", "system-7", "drop-2") for
 * legs already in chance order, so a shape bought can be rebuilt later. Null for an unknown id.
 */
export function shapeLines(id, legs) {
  const n = legs.length;
  if (!n) return null;
  if (id === 'accumulator') return lines.accumulator(n);
  const m = /^(split|system|drop)-(\d+)$/.exec(String(id ?? ''));
  if (!m) return null;
  const k = Number(m[2]);
  if (m[1] === 'split') return k >= 1 ? lines.split(n, k) : null;
  if (m[1] === 'system') return k >= 1 && k < n ? lines.system(n, k) : null;
  return k >= 1 && k < n ? lines.dropWeakest(legs, k) : null;
}

/**
 * What a bought shape returned, from the legs' results (`correct`, `incorrect`, `void` or
 * open) and prices: a line pays its share of the stake times the product of its legs' prices
 * once every leg has won; a void leg drops out at a price of 1; a lost leg settles the line
 * at nothing; a line with an open leg and no lost one is still pending. Legs without a price
 * are taken at fair odds (flagged). `profit` counts the lines settled so far.
 */
export function shapeReturn(legs, ticketLines, {stake = 1} = {}) {
  if (!legs?.length || !ticketLines?.length) return null;
  const perLine = stake / ticketLines.length;
  let returned = 0;
  let pending = false;
  let linesWon = 0;
  for (const line of ticketLines) {
    const results = line.map((i) => legs[i]?.result ?? null);
    if (results.includes('incorrect')) continue;
    if (results.some((r) => r !== 'correct' && r !== 'void')) {
      pending = true;
      continue;
    }
    const payout =
      perLine * line.reduce((acc, i) => acc * (legs[i].result === 'void' ? 1 : oddsOf(legs[i])), 1);
    returned += payout;
    linesWon++;
  }
  return {
    stake,
    returned: round(returned, 2),
    profit: round(returned - stake, 2),
    pending,
    linesWon,
    fairPriced: legs.some((l) => !(Number(l.odds) > 1)),
  };
}
