import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {storybookUIHarness} from './helpers/storybook-ui-dom.js';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('review: resizing with More close focused chooses a visible desktop destination', () => {
  const h = storybookUIHarness(true);
  try {
    h.open(); h.find('.storybook-ui-more').click();
    h.find('.storybook-ui-more-close').focus(); h.resize(false);
    assert.equal(h.find('.storybook-ui-more-panel').hidden, true);
    assert.equal(h.find('.storybook-ui-more').hidden, true);
    assert.equal(h.doc.activeElement, h.buttons[0]);
  } finally {h.cleanup();}
});

test('review: all six original navigation node identities remain under the main dock selector contract', () => {
  const h = storybookUIHarness();
  try {
    const originals = [...h.buttons]; h.open();
    for (const mobile of [true, false, true]) {
      h.resize(mobile);
      const routed = h.doc.querySelectorAll('.dock').flatMap(d => d.querySelectorAll('button')).filter(b => b.dataset.panel);
      assert.equal(routed.length, 6);
      for (const original of originals) assert.equal(routed.filter(node => node === original).length, 1);
    }
    h.handle.deactivate(); assert.deepEqual(h.dock.children, originals);
    assert.match(read('src/client/main.ts'), /querySelectorAll\('\.dock button'\)/);
  } finally {h.cleanup();}
});

test('review: folded development tools never contain original connection or room status', () => {
  const h = storybookUIHarness(true);
  try {
    h.open(); const tools = h.find('.storybook-ui-tools');
    assert.equal(tools.open, false);
    for (const status of [h.state, h.roomBanner]) {
      assert.equal(status.parent, h.hud);
      assert.equal(tools.contains(status), false);
      assert.equal(h.find('.storybook-ui-top').contains(status), true);
    }
    assert.equal(tools.contains(h.iso), true);
    assert.equal(h.state.textContent, 'same status');
  } finally {h.cleanup();}
});

test('review: shell injection stays serve-only and requires the exact opt-in independently of art preview', async () => {
  const {observerDevelopmentScripts, observerWebConfig} = await import(new URL('../scripts/dev-observer-web.mjs', import.meta.url).href);
  const sources = (query: string) => observerDevelopmentScripts('/ai-town/' + query).map((tag: {attrs: {src: string}}) => tag.attrs.src);
  assert.equal(observerWebConfig.plugins[0].apply, 'serve');
  for (const query of ['', '?storybook=1', '?storybook-ui=0', '?storybook-ui=1&storybook-ui=1']) {
    assert.ok(sources(query).every((src: string) => !src.endsWith('/storybook-ui-entry.ts')));
  }
  assert.equal(sources('?storybook-ui=1').filter((src: string) => src.endsWith('/storybook-ui-entry.ts')).length, 1);
  assert.doesNotMatch(read('src/client/main.ts'), /storybook-ui/);
  assert.match(read('src/client/storybook-ui-entry.ts'), /import\s*\{observerMap\}\s*from '\.\/main\.js'/);
  assert.match(read('src/client/storybook-ui-entry.ts'), /import\.meta\.env\.DEV/);
});
