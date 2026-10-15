const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const pct = (v) => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

const tile = (label, value, sub) =>
  `<div class="stat-tile"><span class="stat-label">${esc(label)}</span><strong>${esc(value)}</strong><span class="stat-sub">${esc(sub)}</span></div>`;

const chip = (result) =>
  result === 'correct'
    ? '<i class="chip w" role="img" aria-label="correct">✓</i>'
    : '<i class="chip l" role="img" aria-label="incorrect">✗</i>';

function table(title, head, rows) {
  if (!rows.length) return '';
  const header = head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('');
  const body = rows
    .map(
      (cells) =>
        '<tr>' +
        cells.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('') +
        '</tr>',
    )
    .join('');
  return `<div class="stat-block"><h4>${esc(title)}</h4><div class="table-scroll"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}

/**
 * The public page for a share link: server-rendered, no scripts, every value escaped.
 * `snapshot` comes from buildSnapshot(); `displayName` is null unless the person opted in.
 */
export function renderSharePage({displayName, snapshot: s, updatedAt, origin, id}) {
  const owner = displayName || 'A MatchPredict player';
  const title = `${owner}’s virtual picks · JK MatchPredict`;
  const accuracy = s.accuracy;
  const summary = accuracy
    ? `${s.correct} of ${s.settled} settled virtual picks correct (${pct(accuracy.rate)}).`
    : 'Virtual football picks.';
  const description = `${summary} Virtual picks only, not betting advice.`;
  const link = `${origin}/s/${id}`;

  const tiles = [
    tile(
      'Accuracy',
      pct(accuracy?.rate),
      accuracy ? `95% range ${pct(accuracy.low)}–${pct(accuracy.high)}` : 'No settled picks yet',
    ),
    tile('Record', `${s.correct}–${s.incorrect}`, `${s.settled} settled picks`),
    tile(
      'Current run',
      s.currentStreak
        ? `${s.currentStreak.length} ${s.currentStreak.type === 'correct' ? 'correct' : 'wrong'}`
        : '—',
      `Best run: ${s.bestWinStreak} correct`,
    ),
    tile(
      'Versus forecasts',
      `${s.correct} / ${s.expectedCorrect}`,
      'correct / expected from the forecasts',
    ),
  ].join('');

  const caution = s.smallSample
    ? `<p class="muted">Only ${s.settled} settled pick${s.settled === 1 ? '' : 's'} so far. Percentages swing a lot with so few, which is why the range is shown.</p>`
    : '';
  const recent = s.recent.length
    ? `<div class="stat-block"><h4>Last ${s.recent.length} results</h4><div class="form">${s.recent.map(chip).join('')}</div></div>`
    : '';
  const picks = table(
    'Recent picks',
    ['Match', 'Pick', 'Chance', 'Result'],
    s.picks.map((p) => [
      `${p.home} vs ${p.away} (${p.date})`,
      p.pick,
      p.probability === null ? '—' : p.probability + '%',
      (p.result === 'correct' ? '✓ ' : '✗ ') + (p.score ?? ''),
    ]),
  );
  const competitions = table(
    'By competition',
    ['Competition', 'Picks', 'Accuracy'],
    s.byCompetition.map((c) => [c.name, c.settled, pct(c.accuracy)]),
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="theme-color" content="#0f172a" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${esc(link)}" />
    <meta name="twitter:card" content="summary" />
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <header>
      <div class="header-inner">
        <a class="brand" href="/"><span class="mark">JK</span><span>MatchPredict<small>FOOTBALL INTELLIGENCE</small></span></a>
        <span class="virtual">VIRTUAL PICKS ONLY</span>
      </div>
    </header>
    <main class="share-page">
      <div class="eyebrow">SHARED RESULTS</div>
      <h1>${esc(owner)}’s virtual picks</h1>
      <p class="muted">Snapshot from ${esc(day(updatedAt))}. Virtual picks only: no money is staked and this is not betting advice. Percentages describe these picks, not the accuracy of the forecasts.</p>
      <div class="stat-tiles">${tiles}</div>
      ${caution}
      ${recent}
      <div class="stat-grid">${picks}${competitions}</div>
      <p><a class="primary share-cta" href="/">Make your own picks on JK MatchPredict</a></p>
    </main>
  </body>
</html>
`;
}
