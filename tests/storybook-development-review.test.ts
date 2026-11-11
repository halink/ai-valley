/** Independent synthetic lifetime counterexamples; no browser or aesthetic acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createStorybookDevelopmentSession, type StorybookDevelopmentPort} from '../src/client/storybook-development-session.js';
import {createStorybookAnimatedObserver, type StorybookAnimatedObserverHandle} from '../src/client/storybook-animated-observer.js';
import type {ResidentFollowState} from '../src/client/resident-follow.js';
import {animatedFixture} from './helpers/storybook-animated-fixture.js';
import {developmentHarness, DevelopmentElement} from './helpers/storybook-development-harness.js';

function fixture(deferred = false) {
  const f = animatedFixture(), follows = new Set<() => void>();
  let follow: ResidentFollowState | null = null, suspended = 0, restored = 0, released = 0;
  let resolve!: (atlas: typeof f.atlas) => void;
  let ready!: (view: StorybookAnimatedObserverHandle) => void, tick!: () => void;
  let view: StorybookAnimatedObserverHandle | null = null;
  f.observer.currentFollow = () => follow;
  f.observer.subscribeFollow = fn => {const cb = () => fn(follow); follows.add(cb); return () => {follows.delete(cb);};};
  const port: StorybookDevelopmentPort = {
    prepare: () => deferred ? new Promise(r => {resolve = r;}) : Promise.resolve(f.atlas),
    suspendOriginal() {suspended++; let done = false; return () => {if (!done) {done = true; restored++;}};},
    open(observer, atlas, bundle, callback, check) {
      ready = callback; tick = check;
      view = createStorybookAnimatedObserver(observer, atlas, bundle, f.surface, f.environment);
      let done = false; return () => {if (!done) {done = true; released++; view?.dispose();}};
    },
    status() {},
  };
  const session = createStorybookDevelopmentSession(f.observer, port);
  return {...f, follows, session, port, ready: () => ready(view!), tick: () => {view?.tick(); tick();}, resolve: () => resolve(f.atlas),
    follow(id: string, worldId = f.world.id) {follow = {worldId, personId: id, name: id, status: 'following', roomId: null, roomName: null, precise: true, reason: null}; follows.forEach(fn => fn());},
    get view() {return view;}, get suspended() {return suspended;}, get restored() {return restored;}, get released() {return released;},
  };
}

test('independent dev review: cancellation during atlas preparation never suspends the original view', async () => {
  for (const cancel of ['close', 'dispose', 'room', 'world'] as const) {
    const f = fixture(true), pending = f.session.start(f.r.id);
    if (cancel === 'room') f.room('synthetic-room');
    else if (cancel === 'world') {const next = structuredClone(f.snapshot); next.world.id += '-new'; f.emit(next);}
    else f.session[cancel]();
    f.resolve(); await pending;
    assert.equal(f.session.state, 'idle'); assert.equal(f.suspended, 0); assert.equal(f.view, null);
    f.session.dispose(); assert.equal(f.feeds.size + f.rooms.size + f.follows.size, 0);
  }
});

test('independent dev review: cancelled queued ready cannot resurrect preview or double restore', async () => {
  const f = fixture(); await f.session.start(f.r.id);
  assert.equal(f.session.state, 'loading'); assert.equal(f.suspended, 1);
  f.session.close(); f.ready(); f.session.close(); f.session.dispose(); f.ready();
  assert.equal(f.session.state, 'idle'); assert.equal(f.restored, 1); assert.equal(f.released, 1);
  assert.equal(f.feeds.size + f.rooms.size + f.follows.size + f.changes.size + f.picks.size, 0);
});

test('independent dev review: opening failure restores original exactly once and leaves no view subscriptions', async () => {
  const f = fixture(); f.port.open = () => {throw Error('synthetic open failure');};
  await f.session.start(f.r.id);
  assert.equal(f.session.state, 'idle'); assert.equal(f.suspended, 1); assert.equal(f.restored, 1);
  f.session.dispose(); assert.equal(f.feeds.size + f.rooms.size + f.follows.size, 0);
});

test('independent dev review: synchronous room publication while suspending cancels before Scene acquisition', async () => {
  const f = fixture(); let opened = 0, restored = 0;
  f.port.suspendOriginal = () => {f.room('synchronously-published-room'); return () => {restored++;};};
  f.port.open = () => {opened++; throw Error('Scene must never be acquired after synchronous cancellation');};
  await f.session.start(f.r.id);
  assert.equal(f.session.state, 'idle'); assert.equal(opened, 0); assert.equal(f.view, null); assert.equal(restored, 1);
  assert.equal(f.observer.currentRoom(), 'synchronously-published-room');
  f.session.close(); f.session.dispose(); assert.equal(restored, 1);
  assert.equal(f.feeds.size + f.rooms.size + f.follows.size + f.changes.size + f.picks.size, 0);
});

test('independent dev review: same snapshot identity is retained; disconnection and hiding do not advance world', async () => {
  const f = fixture(), bytes = JSON.stringify(f.world); await f.session.start(f.r.id); f.ready();
  assert.equal(f.session.state, 'active'); assert.equal(f.observer.currentSnapshot(), f.snapshot);
  f.flags.now = 100; f.tick(); const before = f.view!.playback!.records[0].elapsedMs;
  f.emit(f.snapshot, false); f.flags.now = 5000; f.tick();
  assert.equal(f.view!.playback!.records[0].elapsedMs, before);
  f.flags.visible = false; f.changed(); f.flags.now = 10000; f.tick();
  assert.equal(f.view!.playback!.records[0].elapsedMs, before);
  assert.equal(JSON.stringify(f.world), bytes); assert.deepEqual(f.selected, []);
  f.session.dispose(); assert.equal(f.restored, 1);
});

test('independent dev review: swallowed surface error on a source update restores original view', async () => {
  const f = fixture(); await f.session.start(f.r.id); f.ready();
  f.surface.present = () => {throw Error('synthetic drawing failure');};
  f.emit(); assert.equal(f.session.state, 'idle'); assert.equal(f.restored, 1);
  f.session.dispose();
});

test('independent dev review: valid follow uses exact ID and unavailable followed actor restores original', async () => {
  const f = fixture(); await f.session.start(f.r.id); f.ready();
  f.follow(f.r.id); assert.equal(f.session.state, 'active');
  assert.ok(f.view!.plan!.bounds.x <= f.view!.playback!.records[0].anchor!.x);
  f.follow('missing-id'); assert.equal(f.session.state, 'idle'); assert.equal(f.restored, 1);
  f.session.dispose();
});

test('independent dev review: world switch with reused resident ID cannot retain old artwork binding', async () => {
  const f = fixture(); await f.session.start(f.r.id); f.ready();
  const next = structuredClone(f.snapshot); next.world.id += '-replacement'; f.emit(next);
  assert.equal(f.session.state, 'idle'); assert.equal(f.restored, 1); assert.equal(f.released, 1);
  f.session.dispose();
});

test('independent dev review: duplicate actor IDs and indoor starts never suspend the original', async () => {
  for (const invalid of ['duplicate', 'room'] as const) {
    const f = fixture();
    if (invalid === 'duplicate') f.world.residents.push(structuredClone(f.r)); else f.room('room');
    await f.session.start(f.r.id); assert.equal(f.session.state, 'idle'); assert.equal(f.suspended, 0); f.session.dispose();
  }
});

test('independent dev review: production entry has no development mount and optional code owns no transport', () => {
  const read = (name: string) => readFileSync(new URL('../src/client/' + name, import.meta.url), 'utf8');
  assert.doesNotMatch(read('main.ts'), /storybook-development|mountStorybookDevelopment/);
  for (const name of ['storybook-development-session.ts', 'storybook-development-preview.ts', 'storybook-development-entry.ts']) {
    assert.doesNotMatch(read(name), /\b(?:fetch|setInterval|setTimeout|requestAnimationFrame)\s*\(|new\s+(?:EventSource|WebSocket|Game)\s*\(/);
  }
  assert.match(read('storybook-development-entry.ts'), /import\.meta\.env\.DEV/);
});

test('independent dev review: exact query opt-in leaves existing read-only world routes unchanged', async () => {
  const {observerDevelopmentScripts, observerReadOnlyAPI, observerWebConfig} = await import(new URL('../scripts/dev-observer-web.mjs', import.meta.url).href);
  for (const query of ['', '?storybook', '?storybook=0', '?storybook=true', '?storybook=01', '?storybook=1&storybook=1', '?storybook=1&storybook=0', '?Storybook=1', '?other=storybook%3D1', '#storybook=1']) {
    assert.equal(observerDevelopmentScripts('/ai-town/' + query).length, 1, query);
  }
  assert.equal(observerDevelopmentScripts('/ai-town/?storybook=1').length, 2);
  assert.equal(observerWebConfig.plugins[0].apply, 'serve');
  for (const [method, url, expected] of [['GET', '/ai-town/api/world', 0], ['GET', '/ai-town/api/events', 0], ['GET', '/ai-town/api/storybook', 404], ['POST', '/ai-town/api/world', 405], ['POST', '/ai-town/api/storybook', 405]] as const) {
    let forwarded = false; const response = {statusCode: 0, setHeader() {}, end() {}};
    observerReadOnlyAPI({method, url}, response, () => {forwarded = true;});
    assert.equal(response.statusCode, expected); assert.equal(forwarded, expected === 0);
  }
});

test('independent dev review: old Scene deferred removal cannot destroy an immediate replacement', async () => {
  const h = developmentHarness({iso: true});
  try {
    await h.open(); const first = [...h.scenes.values()][0];
    h.stop.dispatchEvent(new Event('click'));
    await h.open(); const second = [...h.scenes.values()][0];
    assert.notEqual(first, second); assert.equal(h.scenes.size, 1); assert.equal(h.textures.size, 1);
    first.events.emit('shutdown'); first.events.emit('destroy'); first.events.emit('preupdate');
    assert.equal(h.scenes.size, 1); assert.equal(h.original.input.enabled, false); assert.equal(h.stop.hidden, false);
    assert.equal(h.counts.isoOff, 2); assert.equal(h.counts.isoOn, 1);
    h.handle.dispose(); await Promise.resolve(); assert.equal(h.scenes.size, 0); assert.equal(h.counts.isoOn, 2);
  } finally {await h.cleanup();}
});

test('independent dev review: queued world change clears dropdown even when new world reuses actor ID', async () => {
  const h = developmentHarness({queued: true});
  try {
    await h.open(); const next = structuredClone(h.snapshot); next.world.id += '-new'; h.emit(next);
    assert.equal(h.select.value, ''); assert.equal(h.start.disabled, true); assert.equal(h.original.input.enabled, true);
    h.flush(); await Promise.resolve(); assert.equal(h.scenes.size, 0); assert.equal(h.textures.size, 0);
    await h.open(); h.flush(); await Promise.resolve(); assert.equal(h.scenes.size, 1); assert.equal(h.textures.size, 1);
    h.room('unchanged-room'); await Promise.resolve(); assert.equal(h.observer.currentRoom(), 'unchanged-room');
    assert.equal(h.scenes.size, 0); assert.equal(h.original.input.enabled, true);
  } finally {await h.cleanup();}
});

test('independent dev review: window capture restores prior iso before the same click reaches document navigation', async () => {
  const source = readFileSync(new URL('../src/client/storybook-development-preview.ts', import.meta.url), 'utf8');
  assert.match(source, /listen\(window, 'click', event => \{[\s\S]*?session!\.close\([\s\S]*?\}, true\)/);
  assert.doesNotMatch(source, /listen\(document, 'click'/);
  for (const action of ['home', 'zoomin', 'zoomout']) {
    const h = developmentHarness({iso: true});
    try {
      // This explicitly simulates the browser's window-capture -> document-capture order.
      // EventTarget mocks do not claim to implement real DOM propagation or rendering.
      let isoRoutes = 0, ordinaryRoutes = 0;
      h.document.addEventListener('click', () => {
        if (h.isoButton.getAttribute('aria-pressed') === 'true') isoRoutes++; else ordinaryRoutes++;
      }, true);
      await h.open(); assert.equal(h.isoButton.getAttribute('aria-pressed'), 'false');
      const target = new DevelopmentElement(); target.dataset.action = action; target.setAttribute('data-action', action);
      const event = new Event('click', {cancelable: true}); Object.defineProperty(event, 'target', {value: target});
      h.window.dispatchEvent(event); assert.equal(h.isoButton.getAttribute('aria-pressed'), 'true');
      assert.equal(event.defaultPrevented, false); h.document.dispatchEvent(event);
      assert.equal(isoRoutes, 1); assert.equal(ordinaryRoutes, 0); assert.equal(h.counts.isoOn, 1);
      await Promise.resolve(); assert.equal(h.scenes.size, 0); assert.equal(h.original.input.enabled, true);
    } finally {await h.cleanup();}
  }
});
