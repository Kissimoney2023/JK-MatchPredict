import {$, esc, formatDate} from '../dom.js';

const BADGE = {ok: 'OK', info: 'Info', warn: 'Check', error: 'Fix', missing: 'Fix'};

/** The report as a list: each line says what, how it stands, and what to do about it. */
export function diagnosticsList(report) {
  const {problems, warnings} = report.summary;
  const headline = problems
    ? `${problems} thing${problems === 1 ? '' : 's'} to fix${warnings ? ` and ${warnings} to check` : ''}.`
    : warnings
      ? `Nothing broken; ${warnings} thing${warnings === 1 ? '' : 's'} worth a look.`
      : 'Everything checked is in order.';
  const rows = report.items
    .map((i) => {
      const state = BADGE[i.state] ? i.state : 'info';
      return `<li class="diag diag-${state}"><span class="diag-state">${BADGE[state]}</span><div><strong>${esc(i.label)}</strong><p>${esc(i.detail)}</p>${i.fix ? `<p class="diag-fix">How to fix: ${esc(i.fix)}</p>` : ''}</div></li>`;
    })
    .join('');
  return `<p><strong>${esc(headline)}</strong> <span class="muted">Checked ${esc(formatDate(report.checkedAt))}.</span></p><ul class="diag-list">${rows}</ul>`;
}

const LOCKED = {
  not_configured:
    'CRON_SECRET is not set on this site yet. Set it in Vercel (any long random string), redeploy, then come back: it is also what lets the scheduled job run.',
  key: 'That key was not accepted. Use the CRON_SECRET value from Vercel (no quotes or spaces).',
};

async function runChecks(key) {
  const box = $('#diagnostics-result');
  box.innerHTML = '<p class="muted">Checking…</p>';
  try {
    const response = await fetch('/api/football?action=diagnostics', {
      headers: {Authorization: 'Bearer ' + key.trim()},
    });
    const report = await response.json();
    if (report.locked)
      box.innerHTML = `<div class="message">${esc(LOCKED[report.reason] ?? LOCKED.key)}</div>`;
    else if (!response.ok) throw Error(report.error || 'Request failed.');
    else box.innerHTML = diagnosticsList(report);
  } catch (e) {
    box.innerHTML = `<div class="message">${esc(e.message || 'The check could not be run.')}</div>`;
  }
}

export function initDiagnostics() {
  const form = $('#diagnostics-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runChecks($('#diagnostics-key').value);
  });
}
