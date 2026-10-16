export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => document.querySelectorAll(selector);

export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c],
  );

export const formatDate = (value) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** A YYYY-MM-DD date shifted by whole days (UTC). */
export const addDays = (isoDate, days) =>
  new Date(Date.parse(isoDate) + days * 86_400_000).toISOString().slice(0, 10);

export const todayUtc = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export function message(text, target = '#feedback') {
  $(target).innerHTML = text ? `<div class="message">${esc(text)}</div>` : '';
}

/**
 * Data-source warnings. When matches loaded anyway (the fallback provider answered) the note is
 * only background, so it is a quiet one-liner with the details a click away; when nothing
 * loaded it stays a visible warning, because it explains why.
 */
export function notice(warnings, {loaded = false, source = ''} = {}, target = '#feedback') {
  const text = (warnings || []).join(' ').trim();
  if (!text) return message('', target);
  if (!loaded) return message(text, target);
  const lead = source ? `Showing matches from ${esc(source)}.` : 'A note about the data source.';
  $(target).innerHTML =
    `<details class="notice"><summary>${lead} <span class="notice-more">Details</span></summary><p>${esc(text)}</p></details>`;
}
