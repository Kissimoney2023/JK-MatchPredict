import {parseOdds, valueCheck, DEFAULT_BANKROLL, KELLY_FRACTION, STAKE_CAP} from '/value.js';
import {fairOdds} from '/analysis.js';
import {$, esc} from '../dom.js';

const BANKROLL_KEY = 'jk-bankroll';
const PICK_LINE = 2.5;

/** The virtual bankroll this browser uses for stake suggestions (never sent anywhere). */
export function bankroll() {
  try {
    const v = Number(localStorage.getItem(BANKROLL_KEY));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_BANKROLL;
  } catch {
    return DEFAULT_BANKROLL;
  }
}

function saveBankroll(value) {
  try {
    if (Number.isFinite(value) && value > 0) localStorage.setItem(BANKROLL_KEY, String(value));
  } catch {
    // a private window or blocked storage: the default is used
  }
}

/** The selections of a forecast a price can be checked against, with their chances (percent). */
export function selectionsOf(f) {
  const out = [
    {id: 'home', label: `${f.home} win`, p: f.p?.[0]},
    {id: 'draw', label: 'Draw', p: f.p?.[1]},
    {id: 'away', label: `${f.away} win`, p: f.p?.[2]},
  ];
  const line = f.goals?.lines?.find((l) => Number(l.line) === PICK_LINE);
  if (line) {
    out.push({id: 'over', label: `Over ${PICK_LINE} goals`, p: line.over});
    out.push({id: 'under', label: `Under ${PICK_LINE} goals`, p: line.under});
  }
  return out.filter((s) => Number.isFinite(Number(s.p)));
}

/**
 * The verdict for one price. `source` decides the caveat: a consensus-led forecast makes a
 * price above fair odds a real difference between bookmakers; a model-led one is weaker.
 */
export function verdictHtml(check, {marketLed = false} = {}) {
  if (!check) return '';
  const stake =
    check.stakeFraction > 0
      ? `${(check.stakeFraction * 100).toFixed(2)}% of your bankroll (${check.stake} of ${check.bankroll})`
      : 'nothing';
  const head = check.value
    ? `<strong class="value-yes">Value by this forecast: ${check.expectedValuePercent > 0 ? '+' : ''}${check.expectedValuePercent}% expected return per unit staked.</strong>`
    : `<strong class="value-no">No value: ${check.expectedValuePercent}% expected return per unit staked.</strong>`;
  const caveat = marketLed
    ? 'This forecast is the bookmakers’ consensus, so a price above its fair odds is a genuine difference between bookmakers, the one edge a retail bettor can rely on. Small edges are still within the noise.'
    : 'This forecast comes from the app’s model, which tested a little worse than the bookmakers. Treat small edges as noise; only large, repeated ones mean anything.';
  return `<p>${head}</p><p class="muted">Price ${check.odds.toFixed(2)} implies ${(check.impliedProbability * 100).toFixed(1)}%; the forecast says ${(check.probability * 100).toFixed(1)}% (fair odds ${check.fairOdds.toFixed(2)}). Edge ${check.edge > 0 ? '+' : ''}${check.edge} points.</p><p class="muted">Suggested stake: <strong>${esc(stake)}</strong>. Quarter Kelly (${KELLY_FRACTION * 100}% of the Kelly optimum), capped at ${STAKE_CAP * 100}% of the bankroll, and zero when there is no edge.</p><p class="muted">${caveat} Virtual picks only; this is arithmetic, not advice.</p>`;
}

/** The block's markup, with the selection list and the empty result area. */
export function valueBlockHtml(f) {
  const selections = selectionsOf(f);
  if (!selections.length) return '';
  const options = selections
    .map(
      (s) =>
        `<option value="${esc(s.id)}">${esc(s.label)} · ${s.p}% · fair ${fairOdds(Number(s.p))?.toFixed(2) ?? '—'}</option>`,
    )
    .join('');
  return `<h3>Check a bookmaker’s price</h3>
  <div class="value-check">
    <label>Selection<select id="value-selection">${options}</select></label>
    <label>Bookmaker’s price<input id="value-odds" inputmode="decimal" placeholder="e.g. 2.25, 5/4 or +125" autocomplete="off" /></label>
    <label>Virtual bankroll<input id="value-bankroll" inputmode="decimal" value="${bankroll()}" /></label>
  </div>
  <div id="value-result" role="status" aria-live="polite"><p class="muted">Enter the price a bookmaker offers to see whether it beats this forecast’s fair odds, and what a disciplined stake would be.</p></div>`;
}

/** Wires the inputs inside the open analysis dialog. Safe to call after every render. */
export function initValueCheck(f) {
  const odds = $('#value-odds');
  if (!odds) return;
  const update = () => {
    const chosen = selectionsOf(f).find((s) => s.id === $('#value-selection').value);
    const price = parseOdds(odds.value);
    const money = Number(String($('#value-bankroll').value).replace(',', '.'));
    if (Number.isFinite(money) && money > 0) saveBankroll(money);
    const result = $('#value-result');
    if (!odds.value.trim()) {
      result.innerHTML =
        '<p class="muted">Enter the price a bookmaker offers to see whether it beats this forecast’s fair odds, and what a disciplined stake would be.</p>';
      return;
    }
    if (!price || !chosen) {
      result.innerHTML =
        '<p class="muted">That is not a price I can read. Use decimal odds like 2.25, fractional like 5/4, or American like +125.</p>';
      return;
    }
    const marketLed = String(f.modelVersion || '').startsWith('market');
    result.innerHTML = verdictHtml(valueCheck(chosen.p, price, {bankroll: bankroll()}), {
      marketLed,
    });
  };
  odds.addEventListener('input', update);
  $('#value-selection').addEventListener('change', update);
  $('#value-bankroll').addEventListener('input', update);
}
