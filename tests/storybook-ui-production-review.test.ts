import assert from 'node:assert/strict';
import {test} from 'node:test';
import {storybookUIHarness} from './helpers/storybook-ui-dom.js';

// Independent DOM contracts only: no browser geometry or real model acceptance.
test('production UI activates once without preview controls and restores lifecycle nodes', () => {
  const h = storybookUIHarness(false, 'live'); try {
    assert.equal(h.handle.active, true);
    assert.equal(h.doc.querySelector('.storybook-ui-launch'), null);
    assert.equal(h.doc.querySelector('.storybook-ui-exit'), null);
    assert.equal(h.doc.querySelector('.storybook-ui-notice'), null);
    assert.equal(h.feeds.size, 1);
    assert.equal(h.remount(), h.handle);
    for (let i = 0; i < 4; i++) h.escape();
    assert.equal(h.handle.active, true); assert.equal(h.escaped, 0);
    h.handle.dispose();
    assert.equal(h.feeds.size, 0); assert.equal(h.watchers.size, 0);
    assert.deepEqual(h.app.childNodes, h.origin);
  } finally {h.cleanup();}
});

test('production restores semantic selection opener after snapshot node replacement', () => {
  const h = storybookUIHarness(false, 'live'); try {
    h.select(); h.profile.click();
    const replacement = h.doc.createElement('button');
    replacement.setAttribute('data-person', h.r.id);
    h.profile.replaceWith(replacement); h.flush(); h.escape();
    assert.equal(h.doc.activeElement, replacement);
    assert.equal(h.handle.active, true);
    replacement.click(); replacement.remove(); h.selection.classList.add('hidden'); h.flush(); h.escape();
    assert.equal(h.doc.activeElement, h.buttons[0]);
  } finally {h.cleanup();}
});

test('production mobile routes, unknown state and nonresident selections are preserved', () => {
  const h = storybookUIHarness(true, 'live'); try {
    h.emit(null, false);
    assert.equal(h.find('.storybook-ui-unknown-clock').hidden, false);
    h.emit(h.snapshot, true); h.select();
    h.profile.remove(); // Animal, construction and building cards have no data-person route.
    const action = h.doc.createElement('button'); action.setAttribute('data-enter', 'communal-house');
    h.selection.append(action); h.flush();
    assert.equal(h.find('.storybook-ui-location').hidden, true);
    assert.equal(h.find('.storybook-ui-card').hidden, false);
    assert.equal(action.parent, h.selection);
    assert.deepEqual(h.dock.children.filter(n => n.dataset.panel).map(n => n.dataset.panel), ['people', 'places', 'chronicle']);
    const more = h.find('.storybook-ui-more'); more.click(); h.buttons[4].click(); h.escape();
    assert.equal(h.doc.activeElement, more);
    assert.equal(h.selected.length, 0);
  } finally {h.cleanup();}
});

test('desktop-to-mobile panel dismissal focuses visible card disclosure, not collapsed actions', () => {
  const h = storybookUIHarness(false, 'live'); try {
    h.select(); h.profile.click(); h.resize(true); h.escape();
    assert.equal(h.doc.activeElement, h.find('.storybook-ui-card-toggle'));
  } finally {h.cleanup();}
});
