import {storybookProductionImportViolations} from './helpers/storybook-production-boundary.js';
/** Mock DOM and Phaser contracts, not actual browser layout/GPU acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {developmentHarness} from './helpers/storybook-development-harness.js';

for (const [width, height] of [[1440, 900], [1280, 720], [390, 844]]) test(`development mock ${width}x${height} retains original renderer until explicit ID/click`, async () => {
  const h = developmentHarness({width, height}); try {
    assert.equal(h.remount(), h.handle); assert.equal(h.counts.add, 0); assert.equal(h.counts.prepare, 0); assert.equal(h.select.value, ''); assert.equal(h.start.disabled, true); assert.equal(h.original.input.enabled, true);
    await h.open(); assert.equal(h.counts.add, 1); assert.equal(h.original.input.enabled, false); assert.equal(h.stop.hidden, false); assert.match(h.notice.textContent, /合成诊断/); assert.match(h.notice.textContent, /PNG/); assert.equal(h.textures.size, 1);
    h.stop.dispatchEvent(new Event('click')); await Promise.resolve(); assert.equal(h.original.input.enabled, true); assert.equal(h.scenes.size, 0); assert.equal(h.textures.size, 0); assert.ok(h.objects.every(d => d.destroyed));
    await h.open(); assert.equal(h.counts.add, 2); h.handle.dispose(); await Promise.resolve(); assert.equal(h.original.input.enabled, true); assert.equal(h.scenes.size, 0);
  } finally {await h.cleanup();}
});
test('development cleanup restores prior 2.5D and original disabled input, never overwrites either', async () => {
  const h = developmentHarness({iso: true, input: false}); try {
    await h.open(); assert.equal(h.counts.isoOff, 1); assert.equal(h.isoButton.getAttribute('aria-pressed'), 'false'); h.handle.dispose(); await Promise.resolve();
    assert.equal(h.counts.isoOn, 1); assert.equal(h.original.input.enabled, false); assert.equal(h.isoButton.getAttribute('aria-pressed'), 'true');
    assert.equal(h.feeds.size + h.rooms.size + h.follows.size + h.changes.size + h.picks.size, 0);
  } finally {await h.cleanup();}
});
test('queued Scene startup cannot revive a closed or disposed preview', async () => {
  for (const dispose of [false, true]) {
    const h = developmentHarness({queued: true}); try {
      await h.open(); assert.equal(h.textures.size, 0); if (dispose) h.handle.dispose(); else h.stop.dispatchEvent(new Event('click'));
      h.flush(); await Promise.resolve(); assert.equal(h.textures.size, 0); assert.equal(h.scenes.size, 0); assert.equal(h.original.input.enabled, true);
    } finally {await h.cleanup();}
  }
});
test('decode, registration, viewport, camera and resize failures all preserve or restore original presentation', async () => {
  for (const reason of ['decode', 'registration', 'viewport', 'camera', 'resize']) {
    const h = developmentHarness({width: reason === 'viewport' ? 300 : 1280}); try {
      if (reason === 'decode') h.failPrepare(); if (reason === 'registration') h.failAdd(); await h.open();
      if (reason === 'camera') {const s = [...h.scenes.values()][0]; s.cameras.main.scrollX = 1; s.events.emit('preupdate');}
      if (reason === 'resize') h.window.dispatchEvent(new Event('resize'));
      await Promise.resolve(); assert.equal(h.original.input.enabled, true, reason); assert.equal(h.scenes.size, 0, reason); assert.equal(h.textures.size, 0, reason); assert.match(h.notice.textContent, /原视图/);
    } finally {await h.cleanup();}
  }
});
test('environment-only draw fault restores immediately without a Scene tick, and lost original removes UI', async () => {
  const h = developmentHarness(); try {
    await h.open(); const s = [...h.scenes.values()][0]; s.cameras.main.scrollX = 1; h.flags.visible = false; h.changed(); await Promise.resolve();
    assert.equal(h.original.input.enabled, true); assert.equal(h.scenes.size, 0); assert.equal(h.stop.hidden, true);
    h.original.events.emit('shutdown'); assert.equal(h.tray.removed, true); assert.equal(h.feeds.size + h.rooms.size + h.follows.size + h.changes.size, 0);
  } finally {await h.cleanup();}
});
test('production entry permits the UI shell, exports the existing Scene and keeps sole transport ownership', () => {
  const main = readFileSync(new URL('../src/client/main.ts', import.meta.url), 'utf8');
  assert.match(main, /export \{scene as observerScene\}/); assert.deepEqual(storybookProductionImportViolations(main,true), []);
  assert.equal((main.match(/new Phaser.Game\(/g) ?? []).length, 1); assert.equal((main.match(/new EventSource\(/g) ?? []).length, 1); assert.equal((main.match(/fetch\(new URL\('world'/g) ?? []).length, 1);
  for (const name of ['storybook-development-session.ts', 'storybook-development-preview.ts', 'storybook-development-entry.ts']) {
    const text = readFileSync(new URL('../src/client/' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\b(?:fetch|EventSource|WebSocket|XMLHttpRequest|submitPlan|stepWorld|setInterval|setTimeout|requestAnimationFrame)\s*\(|new Phaser.Game\(|localStorage|process\.env|from ['"][^'"]*\/(?:server|scripts)\//);
  }
});
