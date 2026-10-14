import {$, $$, message} from './dom.js';
import {state} from './state.js';

function setBusy(on) {
  state.busy = on;
  $('#refresh').disabled = on;
  $('#filters button').disabled = on;
  $('#settle').disabled = on;
  $$('[data-analyze],[data-save]').forEach((b) => {
    b.disabled = on || (b.hasAttribute('data-save') && !!state.analysis?.demo);
  });
  $('#refresh').textContent = on ? 'Loading…' : 'Refresh';
}

/** Runs an async action with the UI locked, showing any error in `target`. */
export async function run(fn, target = '#feedback') {
  if (state.busy) return;
  setBusy(true);
  message('', target);
  try {
    await fn();
  } catch (e) {
    message(e.message, target);
  } finally {
    setBusy(false);
  }
}
