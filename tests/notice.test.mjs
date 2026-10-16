import test from 'node:test';
import assert from 'node:assert/strict';
import {notice} from '../public/js/dom.js';

/** A minimal stand-in for the page: one element that remembers its HTML. */
function withPage(run) {
  const box = {innerHTML: ''};
  const previous = globalThis.document;
  globalThis.document = {querySelector: () => box};
  try {
    run(box);
  } finally {
    globalThis.document = previous;
  }
}

const PLAN =
  'API-Football plan limit: Free plans do not have access to this season, try from 2022 to 2024. Fallback data may be delayed.';

test('when matches loaded anyway the note is quiet, with the details one click away', () => {
  withPage((box) => {
    notice([PLAN], {loaded: true, source: 'football-data.org'});
    assert.match(box.innerHTML, /^<details class="notice">/);
    assert.match(box.innerHTML, /Showing matches from football-data\.org\./);
    assert.match(box.innerHTML, /Free plans do not have access to this season/);
    assert.ok(!box.innerHTML.includes('class="message"'), 'not the amber warning');
  });
});

test('when nothing loaded the warning stays visible, because it explains why', () => {
  withPage((box) => {
    notice([PLAN], {loaded: false, source: 'football-data.org'});
    assert.match(box.innerHTML, /^<div class="message">API-Football plan limit/);
    assert.ok(!box.innerHTML.includes('<details'));
  });
});

test('no warnings clears the area, and several are joined', () => {
  withPage((box) => {
    box.innerHTML = 'old';
    notice([], {loaded: true});
    assert.equal(box.innerHTML, '');
    notice(undefined);
    assert.equal(box.innerHTML, '');
    notice(['One.', 'Two.'], {loaded: true});
    assert.match(box.innerHTML, /One\. Two\./);
    assert.match(box.innerHTML, /A note about the data source\./, 'no source named');
  });
});

test('provider text and the source name are escaped', () => {
  withPage((box) => {
    notice(['<img src=x onerror=alert(1)>'], {loaded: true, source: '<b>evil</b>'});
    assert.ok(!box.innerHTML.includes('<img src=x'));
    assert.ok(!box.innerHTML.includes('<b>evil'));
    assert.match(box.innerHTML, /&lt;img src=x/);
    notice(['<script>x</script>'], {loaded: false});
    assert.ok(!box.innerHTML.includes('<script>'));
  });
});
