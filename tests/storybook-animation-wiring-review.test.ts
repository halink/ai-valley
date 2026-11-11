/** Independent offline wiring counterexamples. No browser, transport or real save. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createStorybookAnimatedObserver} from '../src/client/storybook-animated-observer.js';
import {StorybookAnimationPlayer} from '../src/client/storybook-animation.js';
import type {ObserverMap} from '../src/client/observer-map.js';
import type {Snapshot} from '../src/shared/types.js';
import {buildStorybookAnimationPlan, type StorybookPlan} from '../src/client/storybook-render-plan.js';
import {isometricResidentsFixture} from '../scripts/isometric-residents-fixture.js';
import {bindSyntheticAnimationResident, syntheticAnimationAtlasPixels, SYNTHETIC_ANIMATION_WIDTH, SYNTHETIC_ANIMATION_HEIGHT} from '../src/client/storybook-synthetic-animation-atlas.js';

function fixture(failEnvironment = false) {
  const f = isometricResidentsFixture(), bundle = bindSyntheticAnimationResident(f.walk.id);
  const atlas = {manifest: bundle.manifest, width: SYNTHETIC_ANIMATION_WIDTH, height: SYNTHETIC_ANIMATION_HEIGHT, pixels: syntheticAnimationAtlasPixels()};
  let snapshot: Snapshot = {world: f.world, serverTime: 'synthetic', version: 'synthetic', capabilities: {active: [], pending: []}};
  let now = 0, visible = true, reduced = false, connected = true, room: string | null = null, disposeCount = 0, presents = 0;
  const source = new Set<(s: Snapshot, c: boolean) => void>(), rooms = new Set<(id: string | null) => void>(), changes = new Set<() => void>(), picks = new Set<Function>();
  const originalCalls: unknown[] = [];
  const observer = {currentSnapshot: () => snapshot, currentRoom: () => room, currentTile: () => ({x: 6, y: 3}),
    subscribe(fn: (s: Snapshot, c: boolean) => void) {source.add(fn); fn(snapshot, connected); return () => {source.delete(fn);};},
    subscribeRoom(fn: (r: string | null) => void) {rooms.add(fn); fn(room); return () => {rooms.delete(fn);};},
    select: (v: unknown) => originalCalls.push(v), cover: () => assert.fail('cover'), frame: () => assert.fail('frame'), stopFollowing: () => assert.fail('stopFollowing'), setFollowResolver: () => assert.fail('setFollowResolver'),
  } as unknown as ObserverMap;
  const surface = {present() {presents++;}, subscribePick(fn: Function) {picks.add(fn); return () => {picks.delete(fn);};}, dispose() {disposeCount++;}};
  const environment = {now: () => now, visible: () => visible, reducedMotion: () => reduced, subscribeChange(fn: () => void) {if (failEnvironment) throw Error('environment setup failed'); changes.add(fn); return () => {changes.delete(fn);};}};
  return {...f, bundle, atlas, observer, surface, environment, source, rooms, changes, picks, originalCalls,
    setNow: (v: number) => {now = v;}, setFlags(v: {visible?: boolean; reduced?: boolean}) {visible = v.visible ?? visible; reduced = v.reduced ?? reduced; for (const fn of changes) fn();},
    emit(s = snapshot, c = connected) {snapshot = s; connected = c; for (const fn of source) fn(snapshot, c);},
    room(id: string | null) {room = id; for (const fn of rooms) fn(id);},
    get snapshot() {return snapshot;}, get presents() {return presents;}, get disposed() {return disposeCount;},
  };
}
const start = (f: ReturnType<typeof fixture>) => {const h = createStorybookAnimatedObserver(f.observer, f.atlas, f.bundle, f.surface, f.environment); h.activate(); return h;};

test('review wiring: flag events immediately freeze without scene ticks and recovery does not catch up', () => {
  for (const flag of ['visible', 'reduced'] as const) {
    const f = fixture(), h = start(f); f.setNow(100); h.tick();
    const before = h.playback!.records.find(r => r.id === f.walk.id)!;
    assert.equal(before.elapsedMs, 100); f.setNow(150); f.setFlags({[flag]: flag === 'reduced'});
    assert.equal(h.playback!.records.find(r => r.id === f.walk.id)!.elapsedMs, 100);
    f.setNow(50000); f.setFlags({[flag]: flag === 'visible'}); h.tick();
    assert.equal(h.playback!.records.find(r => r.id === f.walk.id)!.elapsedMs, 100);
    f.setNow(50100); h.tick(); assert.equal(h.playback!.records.find(r => r.id === f.walk.id)!.elapsedMs, 200);
    assert.deepEqual(h.playback!.records.find(r => r.id === f.walk.id)!.anchor, before.anchor); h.dispose();
  }
});
test('review wiring: status-only disconnect freezes existing frame and retains old view independently', () => {
  const f = fixture(), h = start(f); const original = JSON.stringify(f.world);
  f.setNow(100); h.tick(); f.setNow(150); f.emit(f.snapshot, false);
  assert.ok(h.playback!.freezeReasons.includes('disconnected')); assert.equal(h.playback!.records.find(r => r.id === f.walk.id)!.elapsedMs, 100);
  f.setNow(20000); f.emit(f.snapshot, true); assert.equal(h.playback!.records.find(r => r.id === f.walk.id)!.elapsedMs, 100);
  assert.equal(JSON.stringify(f.world), original); assert.deepEqual(f.originalCalls, []); h.dispose();
});
test('review wiring: invalid stale feed fails closed, and valid feed restores only latest accepted evidence', () => {
  const f = fixture(), h = start(f), stale = structuredClone(f.snapshot); stale.world.revision--;
  f.emit(stale); assert.equal(h.plan, null);
  const fresh = structuredClone(f.snapshot); fresh.world.revision = f.world.revision + 1;
  f.emit(fresh); assert.equal((h.plan as StorybookPlan | null)?.revision, fresh.world.revision); h.dispose();
});
test('review wiring: room change suppresses outdoor body and discards prior phase on return', () => {
  const f = fixture(), h = start(f); f.setNow(100); h.tick();
  f.room(f.home.id); assert.equal(h.plan, null); f.setNow(200); f.room(null);
  assert.equal(h.playback!.records.find(r => r.id === f.walk.id)!.elapsedMs, 0); assert.ok(h.plan); h.dispose();
});
test('review wiring: late callbacks and repeated disposal cannot resurrect drawing or selection', () => {
  const f = fixture(), h = start(f), source = [...f.source], room = [...f.rooms], change = [...f.changes], picks = [...f.picks];
  h.dispose(); const count = f.presents;
  source.forEach(fn => fn(f.snapshot, true)); room.forEach(fn => fn(null)); change.forEach(fn => fn()); picks.forEach(fn => fn({x: 0, y: 0}));
  h.activate(); h.tick(); h.dispose();
  assert.equal(f.presents, count); assert.equal(h.plan, null); assert.equal(f.disposed, 1);
  assert.equal(f.source.size + f.rooms.size + f.changes.size + f.picks.size, 0); assert.deepEqual(f.originalCalls, []);
});
test('review wiring: environment acquisition failure releases already-acquired ownership', () => {
  const f = fixture(true); assert.throws(() => start(f), /environment setup failed/);
  assert.equal(f.source.size + f.rooms.size + f.picks.size, 0); assert.equal(f.disposed, 1);
});
test('review wiring: mixed atlas geometry and stale/incomplete plan samples are rejected', () => {
  const f = fixture(), h = start(f), altered = JSON.parse(JSON.stringify(f.atlas.manifest));
  altered.assets[0].groundAnchor.x += .25;
  assert.throws(() => createStorybookAnimatedObserver(f.observer, {...f.atlas, manifest: altered}, f.bundle, f.surface, f.environment), /atlas_mismatch/);
  const sample = h.playback!, bounds = h.plan!.bounds;
  assert.throws(() => buildStorybookAnimationPlan(f.snapshot, f.atlas, bounds, {...sample, revision: sample.revision + 1}), /plan_snapshot/);
  assert.throws(() => buildStorybookAnimationPlan(f.snapshot, f.atlas, bounds, {...sample, records: sample.records.slice(1)}), /plan_residents/); h.dispose();
});
test('review wiring: default client does not import animation wiring and adapters own no transport or loop', () => {
  assert.doesNotMatch(readFileSync(new URL('../src/client/main.ts', import.meta.url), 'utf8'), /storybook-animation-phaser|storybook-animated-observer|mountStorybookAnimationPrototype/);
  for (const file of ['storybook-animated-observer.ts', 'storybook-animation-phaser.ts']) {
    assert.doesNotMatch(readFileSync(new URL('../src/client/' + file, import.meta.url), 'utf8'), /\b(?:fetch|requestAnimationFrame|setInterval|setTimeout)\s*\(|new\s+(?:EventSource|Game)\s*\(/);
  }
});
test('review wiring: half-open fractional culling boundaries and invalid bounds preserve phase', () => {
  const f = fixture(), p = new StorybookAnimationPlayer(f.bundle); p.accept(f.world);
  const sample = (nowMs: number, x: number, width: number) => p.sample({nowMs, connected: true, visible: true, reducedMotion: false}, {x, y: 3, width, height: 1}).records.find(r => r.id === f.walk.id)!;
  assert.equal(sample(0, 6, 1).elapsedMs, 0); assert.equal(sample(100, 6, 1).elapsedMs, 100);
  // Actual interpolated anchor x=6.5 lies exactly on the exclusive right boundary.
  assert.equal(sample(200, 6, .5).elapsedMs, 100);
  f.world.revision++; p.accept(f.world); assert.equal(sample(300, 6, .5).elapsedMs, 100);
  assert.throws(() => sample(400, 6, NaN), /view_bounds/);
  assert.equal(sample(400, 6.5, .5).elapsedMs, 100); assert.equal(sample(500, 6.5, .5).elapsedMs, 200);
});
test('review wiring: a caller navigation window change redraws even when visible resident frames are unchanged', () => {
  const f = fixture(); f.world.residents = [f.walk]; let center = {x: 6, y: 3};
  f.observer.currentTile = () => center;
  const h = start(f); assert.equal(h.plan!.bounds.x, 0);
  center = {x: 14, y: 3}; f.setNow(50); h.tick();
  assert.equal(h.plan!.bounds.x, 2); h.dispose();
});
