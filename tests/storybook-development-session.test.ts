/** Synthetic accepted-feed integration only, not a browser or final-art acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ResidentFollowState} from '../src/client/resident-follow.js';
import {createStorybookAnimatedObserver, type StorybookAnimatedObserverHandle} from '../src/client/storybook-animated-observer.js';
import {createStorybookDevelopmentSession} from '../src/client/storybook-development-session.js';
import {animatedFixture} from './helpers/storybook-animated-fixture.js';
import {clientMainHarness} from './helpers/client-main.js';
import type {ObserverMap} from '../src/client/observer-map.js';

function fixture() {
  const f = animatedFixture(), follows = new Set<() => void>();
  let follow: ResidentFollowState | null = null, preview: StorybookAnimatedObserverHandle | null = null, tick = () => {}, lost = () => {};
  const counts = {prepare: 0, open: 0, close: 0, suspend: 0, restore: 0}, statuses: string[] = [];
  const observer = {...f.observer, currentFollow: () => follow, subscribeFollow(fn: (value: ResidentFollowState | null) => void) {const call = () => fn(follow); follows.add(call); call(); return () => {follows.delete(call);};}};
  let prepare = async () => f.atlas;
  const session = createStorybookDevelopmentSession(observer, {
    prepare: () => {counts.prepare++; return prepare();},
    suspendOriginal: () => {counts.suspend++; let done = false; return () => {if (!done) {done = true; counts.restore++;}};},
    open(source, atlas, bundle, ready, onTick, onLost) {counts.open++; tick = onTick; lost = onLost; preview = createStorybookAnimatedObserver(source, atlas, bundle, f.surface, f.environment); ready(preview); let closed = false; return () => {if (!closed) {closed = true; counts.close++; preview?.dispose();}};},
    status: message => statuses.push(message),
  });
  return {...f, observer, session, follows, counts, statuses, get preview() {return preview;}, tick: () => {preview?.tick(); tick();}, lost: () => lost(),
    defer() {let resolve!: (value: typeof f.atlas) => void; prepare = () => new Promise(r => {resolve = r;}); return () => resolve(f.atlas);},
    rejectPrepare() {prepare = async () => {throw Error('synthetic decoder failure');};},
    follow(id: string | null) {follow = id ? {worldId: f.world.id, personId: id, name: 'Synthetic', status: 'following', roomId: null, roomName: null, precise: true, reason: null} : null; for (const fn of follows) fn();},
  };
}
test('development session stays passive until explicit existing resident ID; duplicate activation owns one preview', async () => {
  const f = fixture(), before = structuredClone(f.world);
  assert.equal(f.session.state, 'idle'); assert.equal(f.counts.prepare, 0);
  await f.session.start(''); await f.session.start('missing'); assert.equal(f.counts.open, 0);
  await f.session.start(f.r.id); await f.session.start(f.r.id);
  assert.equal(f.session.state, 'active'); assert.equal(f.counts.prepare, 1); assert.equal(f.counts.open, 1);
  assert.equal(f.preview!.plan!.worldId, f.world.id); assert.equal(f.preview!.playback!.records[0].id, f.r.id);
  assert.deepEqual(f.world, before); f.session.dispose(); f.session.dispose();
  assert.deepEqual(f.counts, {prepare: 1, open: 1, close: 1, suspend: 1, restore: 1});
  assert.equal(f.feeds.size + f.rooms.size + f.follows.size + f.changes.size + f.picks.size, 0);
});
for (const operation of ['close', 'dispose', 'world', 'room'] as const) test(`late image preparation cannot activate after ${operation}`, async () => {
  const f = fixture(), resolve = f.defer(), starting = f.session.start(f.r.id);
  assert.equal(f.session.state, 'loading'); assert.equal(f.counts.suspend, 0);
  if (operation === 'close') f.session.close();
  else if (operation === 'dispose') f.session.dispose();
  else if (operation === 'room') f.room('synthetic-room');
  else {const next = structuredClone(f.snapshot); next.world.id = 'other-world'; f.emit(next);}
  resolve(); await starting; assert.equal(f.counts.open, 0); assert.equal(f.counts.suspend, 0); assert.equal(f.session.state, 'idle'); f.session.dispose();
});
test('preparation failure retains original view and permits explicit retry', async () => {
  const f = fixture(); f.rejectPrepare(); await f.session.start(f.r.id);
  assert.equal(f.session.state, 'idle'); assert.equal(f.counts.suspend, 0); assert.match(f.statuses.at(-1)!, /原视图/); f.session.dispose();
});
test('same identity follows accepted position without writing navigation or world', async () => {
  const f = fixture(); await f.session.start(f.r.id); f.follow(f.r.id);
  f.r.at = {x: 30, y: 30}; f.r.activity!.target = {x: 31, y: 30}; f.r.activity!.path = [{x: 31, y: 30}]; f.world.revision++;
  const before = structuredClone(f.world); f.emit();
  assert.equal(f.session.state, 'active'); assert.equal(f.preview!.plan!.bounds.x, 16); assert.equal(f.preview!.plan!.bounds.y, 16);
  assert.equal(f.observer.currentFollow()!.personId, f.r.id); assert.deepEqual(f.world, before);
  f.session.close(); assert.equal(f.observer.currentFollow()!.personId, f.r.id); assert.equal(f.counts.restore, 1); f.session.dispose();
});
test('unknown follow position restores original view rather than moving person to an invented place', async () => {
  const f = fixture(); await f.session.start(f.r.id); f.follow(f.r.id); f.r.at = {x: -1, y: -1}; f.world.revision++; f.emit();
  assert.equal(f.session.state, 'idle'); assert.equal(f.counts.restore, 1); assert.equal(f.observer.currentFollow()!.personId, f.r.id); f.session.dispose();
});
for (const reason of ['paused', 'disconnected', 'hidden', 'reduced-motion'] as const) test(`integrated ${reason} freezes without catch-up or new world positions`, async () => {
  const f = fixture(); await f.session.start(f.r.id); f.flags.now = 100; f.tick(); const at = f.preview!.playback!.records[0].anchor;
  if (reason === 'paused') {f.world.clock.paused = true; f.world.revision++; f.emit();}
  if (reason === 'disconnected') f.emit(f.snapshot, false);
  if (reason === 'hidden') {f.flags.visible = false; f.changed();}
  if (reason === 'reduced-motion') {f.flags.reducedMotion = true; f.changed();}
  const phase = f.preview!.playback!.records[0].elapsedMs; assert.ok(f.preview!.playback!.freezeReasons.includes(reason));
  f.flags.now += 6000; f.tick(); assert.equal(f.preview!.playback!.records[0].elapsedMs, phase); assert.deepEqual(f.preview!.playback!.records[0].anchor, at);
  f.world.clock.paused = false; f.flags.visible = true; f.flags.reducedMotion = false; f.emit(); f.changed(); f.tick();
  assert.equal(f.preview!.playback!.records[0].elapsedMs, phase); assert.equal(f.session.state, 'active'); f.session.dispose();
});
test('swallowed drawing failure, missing snapshot and scene loss all restore once and release original feed', async () => {
  for (const reason of ['draw', 'missing', 'lost']) {
    const f = fixture(); await f.session.start(f.r.id);
    if (reason === 'draw') {f.surface.present = () => {throw Error('synthetic draw failure');}; f.world.revision++; f.emit();}
    if (reason === 'missing') f.emit(null, false);
    if (reason === 'lost') f.lost();
    assert.equal(f.session.state, 'idle'); assert.equal(f.counts.restore, 1); assert.equal(f.counts.close, 1);
    f.session.dispose(); assert.equal(f.feeds.size + f.rooms.size + f.follows.size + f.changes.size + f.picks.size, 0);
  }
});
test('indoor observation falls back without changing the committed room; later explicit retry works', async () => {
  const f = fixture(); await f.session.start(f.r.id); f.room('the-original-room'); assert.equal(f.session.state, 'idle'); assert.equal(f.observer.currentRoom(), 'the-original-room');
  await f.session.start(f.r.id); assert.equal(f.counts.open, 1);
  f.room(null); await f.session.start(f.r.id); assert.equal(f.session.state, 'active'); assert.equal(f.counts.open, 2); f.session.dispose();
});
test('actual main reconciliation feeds diagnostic session with one world GET and SSE, including later accepted snapshot identity', async () => {
  const f = animatedFixture(); let source: ObserverMap | null = null, view: StorybookAnimatedObserverHandle | null = null;
  let session: ReturnType<typeof createStorybookDevelopmentSession> | null = null;
  const h = await clientMainHarness(f.snapshot, async () => ({}), undefined, value => {
    source = value as ObserverMap;
    session = createStorybookDevelopmentSession(source, {
      prepare: async () => f.atlas, suspendOriginal: () => () => {}, status() {},
      open(observer, atlas, bundle, ready) {view = createStorybookAnimatedObserver(observer, atlas, bundle, f.surface, f.environment); ready(view); return () => view?.dispose();},
    });
  });
  await session!.start(f.r.id); assert.equal(session!.state, 'active');
  assert.equal(source!.currentSnapshot(), h.accepted.at(-1)); assert.equal(view!.plan!.worldId, f.world.id);
  const next = structuredClone(f.snapshot); next.world.revision++; next.world.residents[0].activity!.travelProgress = .75; h.update(next);
  assert.equal(source!.currentSnapshot(), h.accepted.at(-1)); assert.equal(view!.plan!.revision, next.world.revision);
  assert.equal(view!.playback!.records[0].id, f.r.id); assert.equal(view!.playback!.records[0].anchor!.x, 20.75);
  assert.equal(h.worldRequests, 1); assert.equal(h.eventSources, 1); assert.equal(h.observerMountCalls, 1);
  session!.dispose();
});
