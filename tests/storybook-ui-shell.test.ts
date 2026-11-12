import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {storybookUIHarness} from './helpers/storybook-ui-dom.js';
import {storybookResidentLocation} from '../src/client/storybook-ui-shell.js';
import {clientMainHarness} from './helpers/client-main.js';
const read = (file: string) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('default inactive, idempotent mount/open/dispose and exact original node restoration', () => {
  const h = storybookUIHarness(); try {
    assert.equal(h.handle.active, false); assert.equal(h.feeds.size, 0); assert.equal(h.remount(), h.handle);
    const launcher = h.find('.storybook-ui-launch'); const initialHUD = h.hud.childNodes.slice();
    h.open(); h.handle.activate(); assert.equal(h.feeds.size, 1); assert.equal(h.handle.active, true);
    assert.equal(h.state.parent, h.hud); assert.equal(h.roomBanner.parent, h.hud); assert.equal(h.hud.parent, h.find('.storybook-ui-top'));
    assert.equal(h.find('.storybook-ui-tools').open, false); assert.equal(h.iso.parent, h.find('.storybook-ui-tools'));
    assert.equal(h.buttons.length, 6); assert.ok(h.buttons.every(b => b.parent === h.dock)); assert.equal(h.find('.storybook-ui-more').hidden, true);
    h.handle.deactivate(); assert.deepEqual(h.app.childNodes.filter(n => n !== h.find('.storybook-ui-shell')), h.origin);
    assert.deepEqual(h.hud.childNodes, initialHUD); assert.equal(h.feeds.size, 0); assert.equal(h.watchers.size, 0); assert.equal(h.doc.activeElement, launcher);
    h.open(); h.handle.dispose(); h.handle.dispose(); h.handle.activate(); assert.equal(h.handle.active, false);
    assert.deepEqual(h.app.childNodes, h.origin); assert.deepEqual(h.hud.childNodes, h.hudOrigin);
    const replacement = h.remount(); assert.notEqual(replacement, h.handle); replacement.dispose();
  } finally {h.cleanup();}
});

test('mobile four destinations and more preserve all six original routes, active state and return focus', () => {
  const h = storybookUIHarness(true); try {
    h.open(); const more = h.find('.storybook-ui-more'), menu = h.find('.storybook-ui-more-panel');
    assert.deepEqual(h.dock.children.filter(n => n.dataset.panel).map(n => n.dataset.panel), ['people', 'places', 'chronicle']);
    assert.deepEqual(menu.children.filter(n => n.dataset.panel).map(n => n.dataset.panel), ['relations', 'conversations', 'wild']);
    for (const index of [0, 1, 2, 3, 4, 5]) {
      if ([1, 2, 4].includes(index)) more.click(); h.buttons[index].focus(); h.buttons[index].click();
      assert.equal(menu.hidden, true); assert.equal(h.buttons[index].getAttribute('aria-expanded'), 'true'); assert.equal(h.doc.activeElement, h.closePanel);
      h.escape(); assert.equal(h.panel.classList.contains('hidden'), true); assert.equal(h.escaped, 0); assert.equal(h.handle.active, true);
      assert.equal(h.doc.activeElement, [1, 2, 4].includes(index) ? more : h.buttons[index]);
      assert.ok(h.buttons.every(b => b.getAttribute('aria-expanded') === 'false'));
    }
    assert.equal(h.routes, 6); more.click(); assert.equal(h.doc.activeElement, h.buttons[1]); h.escape(); assert.equal(h.doc.activeElement, more);
  } finally {h.cleanup();}
});

test('mobile card disclosure, long-record expansion and Escape do not alter selection/follow/room', () => {
  const h = storybookUIHarness(true); try {
    h.room('original-room'); h.open(); h.select();
    const card = h.find('.storybook-ui-card'), toggle = h.find('.storybook-ui-card-toggle');
    assert.ok(card.classList.contains('storybook-ui-collapsed')); toggle.click(); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    h.escape(); assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(h.handle.active, true);
    toggle.click(); h.profile.click(); const expand = h.find('.storybook-ui-panel-expand'); expand.click(); assert.equal(expand.getAttribute('aria-expanded'), 'true');
    h.escape(); assert.equal(h.observer.currentRoom(), 'original-room'); assert.equal(h.selection.classList.contains('hidden'), false); assert.equal(h.doc.activeElement, h.profile);
    h.profile.click(); assert.equal(expand.getAttribute('aria-expanded'), 'false'); h.escape(); h.escape(); h.escape(); assert.equal(h.handle.active, false);
    assert.equal(h.selected.length, 0); assert.equal(h.observer.currentRoom(), 'original-room');
  } finally {h.cleanup();}
});

test('responsive changes recover hidden focus and retain nodes over repeated opens', () => {
  const h = storybookUIHarness(); try {
    h.open(); h.buttons[1].focus(); h.resize(true); const more = h.find('.storybook-ui-more'); assert.equal(h.doc.activeElement, more);
    more.click(); h.buttons[2].focus(); h.resize(false); assert.equal(h.buttons[2].parent, h.dock); assert.equal(h.doc.activeElement, h.buttons[2]);
    for (let n = 0; n < 3; n++) {h.handle.deactivate(); h.open(); h.resize(true); h.resize(false);}
    assert.equal(h.feeds.size, 1); assert.equal(h.dock.children.filter(n => n.dataset.panel).length, 6);
  } finally {h.cleanup();}
});

test('missing snapshots, unknown positions and interrupted mount never fabricate state', () => {
  const h = storybookUIHarness(); try {
    h.emit(null, false); h.open(); assert.ok(h.find('.storybook-ui-top').classList.contains('storybook-ui-no-snapshot'));
    h.emit(h.snapshot, false); h.select(); h.flush(); assert.match(h.find('.storybook-ui-location').textContent, /地图 20, 20/); assert.equal(h.state.textContent, 'same status');
    h.r.at.x = NaN; assert.match(storybookResidentLocation(h.observer, h.r.id), /位置未知/);
    h.r.residency = 'outside'; assert.match(storybookResidentLocation(h.observer, h.r.id), /镇外/);
    h.r.residency = 'resident'; h.r.status = 'dead'; assert.match(storybookResidentLocation(h.observer, h.r.id), /已故/);
    h.r.status = 'alive'; h.r.inside = 'missing-room'; assert.match(storybookResidentLocation(h.observer, h.r.id), /未知/);
    h.handle.deactivate(); h.failObserve(); h.open(); assert.equal(h.handle.active, false); assert.match(h.find('.storybook-ui-launch').textContent, /加载失败/); assert.equal(h.feeds.size, 0);
    assert.equal(h.panel.parent, h.app); assert.equal(h.selection.parent, h.app); assert.equal(h.iso.parent, h.hud);
  } finally {h.cleanup();}
});

test('legacy dev URL and default formal UI keep one existing world GET/SSE', async () => {
  const {observerDevelopmentScripts} = await import(new URL('../scripts/dev-observer-web.mjs', import.meta.url).href);
  for (const query of ['', '?storybook-ui', '?storybook-ui=0', '?storybook-ui=true', '?storybook-ui=1&storybook-ui=0', '?storybook-ui=1&storybook-ui=1', '#storybook-ui=1']) assert.equal(observerDevelopmentScripts('/ai-town/' + query).length, 1, query);
  assert.equal(observerDevelopmentScripts('/ai-town/?storybook-ui=1').length, 2);
  assert.equal(observerDevelopmentScripts('/ai-town/?storybook=1&storybook-ui=1').length, 3);
  const h = storybookUIHarness(); try {
    const main = await clientMainHarness(h.snapshot, async () => ({})); assert.equal(main.worldRequests, 1); assert.equal(main.eventSources, 1);
    assert.match(read('src/client/main.ts'), /mountStorybookUIShell\(observerMap,\{mode:'live'\}\)/);
    for (const file of ['src/client/storybook-ui-shell.ts', 'src/client/storybook-ui-entry.ts']) assert.doesNotMatch(read(file), /\b(?:fetch|EventSource|WebSocket|setInterval|requestAnimationFrame|submitPlan|stepWorld)\s*\(|localStorage/);
    assert.doesNotMatch(read('src/client/storybook-ui-entry.ts'), /mountStorybookUIShell|hot\.dispose/);
  } finally {h.cleanup();}
});

test('CSS contracts declare reference layout, readable palette, safe areas and reduced motion; not pixel QA', () => {
  const css = read('src/client/storybook-ui-shell.css');
  for (const token of ['#f4ecd9', '#3e382f', 'width:304px', 'min-height:44px', 'max-height:40dvh', 'grid-template-columns:repeat(4', 'env(safe-area-inset-bottom)', 'prefers-reduced-motion:reduce', ':focus-visible', 'font-size:13px', 'height:40dvh']) assert.ok(css.includes(token), token);
  assert.doesNotMatch(css, /url\(/); assert.match(css, /\.storybook-ui-shell #wild-shortcut.hidden\{display:flex!important\}/);
});
