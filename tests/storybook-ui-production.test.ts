import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {storybookUIHarness} from './helpers/storybook-ui-dom.js';

test('formal UI mounts immediately with one subscription and no preview launcher or exit', () => {
  const h = storybookUIHarness(false, 'live');
  try {
    assert.equal(h.handle.active, true); assert.equal(h.feeds.size, 1);
    assert.equal(h.doc.querySelector('.storybook-ui-launch'), null);
    assert.equal(h.doc.querySelector('.storybook-ui-exit'), null);
    assert.equal(h.doc.querySelector('.storybook-ui-notice'), null);
    assert.equal(h.doc.activeElement, null, 'initial load does not steal keyboard focus');
    assert.equal(h.remount(), h.handle); assert.equal(h.feeds.size, 1);
    for (const button of h.buttons) {button.click(); assert.equal(h.panel.classList.contains('hidden'), false); h.escape();}
    assert.equal(h.routes, 6); h.escape(); h.escape();
    assert.equal(h.handle.active, true); assert.equal(h.escaped, 0);
    h.handle.dispose(); assert.equal(h.feeds.size, 0); assert.deepEqual(h.app.childNodes, h.origin);
  } finally {h.cleanup();}
});

test('formal mobile card and reading expansion are reversible without resetting observation', () => {
  const h = storybookUIHarness(true, 'live');
  try {
    h.room('kept-room'); h.select();
    h.find('.storybook-ui-card-toggle').click(); h.profile.click();
    h.find('.storybook-ui-panel-expand').click(); h.escape();
    assert.equal(h.doc.activeElement, h.profile);
    h.escape(); assert.equal(h.find('.storybook-ui-card-toggle').getAttribute('aria-expanded'), 'false');
    h.escape(); assert.equal(h.handle.active, true); assert.equal(h.observer.currentRoom(), 'kept-room');
    assert.equal(h.selection.classList.contains('hidden'), false);
    assert.deepEqual(h.selected, []);
    h.resize(false); h.resize(true); assert.equal(h.feeds.size, 1);
  } finally {h.cleanup();}
});

test('formal entry imports the common theme and mounts the original observer without development gating', () => {
  const main = readFileSync(new URL('../src/client/main.ts', import.meta.url), 'utf8');
  assert.match(main, /import '\.\/storybook-ui-shell.css'/);
  assert.match(main, /mountStorybookUIShell\(observerMap,\{mode:'live'\}\)/);
  const css = readFileSync(new URL('../src/client/storybook-ui-shell.css', import.meta.url), 'utf8');
  for (const contract of ['.room-banner{position:static', '.storybook-ui-top{pointer-events:none}', 'forced-colors:active', 'scrollbar-gutter:stable', '.panel-body table', '.place-actions', '.profile-facts']) assert.ok(css.includes(contract), contract);
});
