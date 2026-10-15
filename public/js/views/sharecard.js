const W = 1200;
const H = 630;
const GREEN = '#22c55e';
const RED = '#ef4444';
const TEXT = '#f8fafc';
const MUTED = '#94a3b8';

const pct = (v) => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%');

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Fonts used by the page are loaded lazily; make sure the card's fonts are ready first. */
export async function loadCardFonts() {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load('700 40px "Fira Sans"'),
    document.fonts.load('500 20px "Fira Sans"'),
    document.fonts.load('600 40px "Fira Code"'),
  ]).catch(() => {});
}

/**
 * Draws the 1200x630 result card for a pickstats summary. Everything is drawn from the data
 * the person already sees; nothing leaves the browser.
 */
export function drawShareCard(canvas, summary, {name = '', host = ''} = {}) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f172a');
  bg.addColorStop(1, '#0b1220');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 120, -40, 20, W - 120, -40, 620);
  glow.addColorStop(0, 'rgba(34,197,94,0.28)');
  glow.addColorStop(1, 'rgba(34,197,94,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Brand
  ctx.fillStyle = GREEN;
  roundRect(ctx, 56, 48, 56, 56, 14);
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.font = '600 26px "Fira Code", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('JK', 84, 77);
  ctx.textAlign = 'left';
  ctx.fillStyle = TEXT;
  ctx.font = '700 30px "Fira Sans", system-ui, sans-serif';
  ctx.fillText('MatchPredict', 128, 68);
  ctx.fillStyle = MUTED;
  ctx.font = '500 15px "Fira Sans", system-ui, sans-serif';
  ctx.fillText('FOOTBALL INTELLIGENCE', 128, 92);

  ctx.textAlign = 'right';
  ctx.fillStyle = GREEN;
  ctx.font = '600 16px "Fira Sans", system-ui, sans-serif';
  ctx.fillText('VIRTUAL PICKS ONLY', W - 56, 77);
  ctx.textAlign = 'left';

  // Title
  ctx.fillStyle = TEXT;
  ctx.font = '700 44px "Fira Sans", system-ui, sans-serif';
  ctx.fillText(name ? `${name}’s virtual picks` : 'My virtual picks', 56, 168);

  // Headline accuracy
  const accuracy = summary.accuracy;
  ctx.fillStyle = GREEN;
  ctx.font = '600 120px "Fira Code", monospace';
  ctx.fillText(pct(accuracy?.rate), 56, 266);
  ctx.fillStyle = TEXT;
  ctx.font = '600 26px "Fira Sans", system-ui, sans-serif';
  ctx.fillText('accuracy', 60, 352);
  ctx.fillStyle = MUTED;
  ctx.font = '500 22px "Fira Sans", system-ui, sans-serif';
  ctx.fillText(
    `95% range ${pct(accuracy?.low)}–${pct(accuracy?.high)} · ${summary.settled} settled picks`,
    60,
    388,
  );

  // Side stats
  const stats = [
    ['Record', `${summary.correct}–${summary.incorrect}`],
    [
      'Current run',
      summary.currentStreak
        ? `${summary.currentStreak.length} ${summary.currentStreak.type === 'correct' ? 'correct' : 'wrong'}`
        : '—',
    ],
    ['Correct vs expected', `${summary.correct} / ${summary.expectedCorrect}`],
  ];
  stats.forEach(([label, value], i) => {
    const x = 640 + (i % 1) * 0;
    const y = 190 + i * 96;
    ctx.fillStyle = 'rgba(27,35,54,0.9)';
    roundRect(ctx, x, y, 504, 80, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font = '500 20px "Fira Sans", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 24, y + 42);
    ctx.fillStyle = TEXT;
    ctx.font = '600 32px "Fira Code", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(value, x + 504 - 24, y + 42);
    ctx.textAlign = 'left';
  });

  // Last results
  const recent = [...summary.recent].reverse(); // oldest to newest
  ctx.fillStyle = MUTED;
  ctx.font = '500 20px "Fira Sans", system-ui, sans-serif';
  ctx.fillText(`Last ${recent.length} results`, 56, 450);
  recent.forEach((result, i) => {
    const x = 56 + i * 52;
    ctx.fillStyle = result === 'correct' ? GREEN : RED;
    roundRect(ctx, x, 468, 42, 42, 9);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 24px "Fira Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(result === 'correct' ? '✓' : '✗', x + 21, 490);
    ctx.textAlign = 'left';
  });

  // Footer
  ctx.fillStyle = MUTED;
  ctx.font = '500 18px "Fira Sans", system-ui, sans-serif';
  const caution = summary.smallSample
    ? `Small sample (${summary.settled} settled picks): treat percentages with care. `
    : '';
  ctx.fillText(`${caution}Virtual picks only. Not betting advice.`, 56, 578);
  ctx.textAlign = 'right';
  ctx.fillStyle = TEXT;
  ctx.font = '600 20px "Fira Sans", system-ui, sans-serif';
  ctx.fillText(host, W - 56, 578);
  ctx.textAlign = 'left';
}
