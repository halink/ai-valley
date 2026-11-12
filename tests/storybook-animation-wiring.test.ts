import {storybookProductionImportViolations} from './helpers/storybook-production-boundary.js';
/** Synthetic snapshot-to-texture contracts, not browser/Phaser GPU or autonomous-life acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createStorybookAnimatedObserver} from '../src/client/storybook-animated-observer.js';
import {buildStorybookAnimationPlan, pickStorybookPlan} from '../src/client/storybook-render-plan.js';
import {projectStorybook, storybookFacing} from '../src/client/storybook-geometry.js';
import {stepWorld, submitPlan} from '../src/world/engine.js';
import {animatedFixture} from './helpers/storybook-animated-fixture.js';
const mount = (f: ReturnType<typeof animatedFixture>) => createStorybookAnimatedObserver(f.observer, f.atlas, f.bundle, f.surface, f.environment);
const advance = (f: ReturnType<typeof animatedFixture>) => {f.world.minute += .25; f.world.revision++;};
const record = (h: ReturnType<typeof mount>) => h.playback!.records[0];
const draw = (h: ReturnType<typeof mount>) => h.plan!.draws.find(d => d.selection?.kind === 'person')!;

test('explicit animated wiring remains inactive by default, shares one source and cleans all owned listeners', () => {
  const f = animatedFixture(), h = mount(f); assert.equal(h.plan, null); assert.equal(f.feeds.size, 1); assert.equal(f.rooms.size, 1);
  h.activate(); assert.ok(h.plan); assert.equal(record(h).artwork?.frameIndex, 0);
  f.flags.now = 100; h.tick(); assert.equal(record(h).artwork?.frameIndex, 1);
  for (let i = 0; i < 3; i++) {h.deactivate(); assert.equal(h.plan, null); f.flags.now += 1000; h.activate(); assert.equal(record(h).elapsedMs, 100);}
  const late = [...f.feeds, ...f.changes]; h.dispose(); h.dispose();
  assert.equal(f.feeds.size + f.rooms.size + f.picks.size + f.changes.size, 0); assert.equal(f.disposal, 1);
  for (const callback of late) (callback as Function)(f.snapshot, true); h.activate(); h.tick(); assert.equal(h.plan, null);
});
for (const [dx, dy, direction] of [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']] as const) {
  test(`draws all six real synthetic cels for ${direction} with stable recorded foot and source-pixel picking`, () => {
    const f = animatedFixture(); f.r.activity!.path = [{x: 20 + dx, y: 20 + dy}];
    const before = structuredClone(f.world), h = mount(f); h.activate(); const frames = new Set<string>();
    for (let time = 0; time < 600; time += 100) {
      f.flags.now = time; h.tick(); const d = draw(h); frames.add(d.assetId);
      assert.equal(d.facing, storybookFacing(direction)); assert.deepEqual(d.position, projectStorybook({x: 20.5 + dx * .25, y: 20.5 + dy * .25}));
      assert.equal(d.topLeft.x + d.frame.foot.x, d.position.x); assert.equal(d.topLeft.y + d.frame.foot.y, d.position.y);
      assert.deepEqual(d.frame, record(h).artwork!.frame);
      const rect = d.frame.rect; let hit = false;
      for (let y = 0; y < rect.height && !hit; y++) for (let x = 0; x < rect.width; x++) if (f.atlas.pixels[((rect.y + y) * f.atlas.width + rect.x + x) * 4 + 3]) {
        const at = {x: d.topLeft.x + x + .5, y: d.topLeft.y + y + .5};
        assert.equal(pickStorybookPlan(h.plan!, f.atlas, at, {origin: {x: 0, y: 0}, zoom: 1})!.selection!.id, f.r.id);
        for (const fn of f.picks) fn(at); hit = true; break;
      }
      assert.ok(hit);
    }
    assert.equal(frames.size, 6); assert.equal(f.selected.length, 6); assert.deepEqual(f.world, before); h.dispose();
  });
}
for (const flag of ['paused', 'disconnected', 'hidden', 'reduced-motion'] as const) {
  test(`${flag} freezes immediately without needing scene ticks or a new snapshot, recovery never catches up`, () => {
    const f = animatedFixture(), h = mount(f); h.activate(); f.flags.now = 100; h.tick(); const first = draw(h).assetId;
    f.flags.now = 150;
    if (flag === 'paused') {f.world.clock.paused = true; f.emit();}
    else if (flag === 'disconnected') f.emit(f.snapshot, false);
    else {if (flag === 'hidden') f.flags.visible = false; else f.flags.reducedMotion = true; f.changed();}
    assert.ok(h.playback!.freezeReasons.includes(flag)); assert.equal(record(h).elapsedMs, 100); assert.equal(draw(h).assetId, first);
    f.flags.now = 100000;
    if (flag === 'paused') {f.world.clock.paused = false; f.emit();}
    else if (flag === 'disconnected') f.emit();
    else {f.flags.visible = true; f.flags.reducedMotion = false; f.changed();}
    assert.equal(record(h).elapsedMs, 100); f.flags.now += 100; h.tick(); assert.equal(record(h).elapsedMs, 200); h.dispose();
  });
}
test('a changed real route stops or turns immediately and no-progress revisions never restart limbs', () => {
  const f = animatedFixture(), h = mount(f); h.activate(); f.flags.now = 100; h.tick(); advance(f); f.emit();
  f.flags.now = 200; h.tick(); assert.equal(record(h).elapsedMs, 100); f.world.revision++; f.emit(); f.flags.now = 300; h.tick(); assert.equal(record(h).elapsedMs, 100);
  f.r.activity!.travelProgress = .5; advance(f); f.emit(); f.flags.now = 400; h.tick(); assert.equal(record(h).elapsedMs, 200);
  f.r.activity!.path = [{x: 20, y: 21}]; f.world.revision++; f.emit(); assert.equal(record(h).direction, 'south'); assert.equal(record(h).elapsedMs, 0); assert.equal(draw(h).facing, 'southwest');
  f.r.activity!.path = []; f.r.activity!.target = {...f.r.at}; f.r.activity!.travelProgress = 0; advance(f); f.emit(); assert.equal(record(h).clip, 'idle'); assert.match(draw(h).assetId, /idle/); h.dispose();
});
test('unsupported and blocked positions are authoritative fallbacks, never the old static route marker', () => {
  for (const patch of [
    (f: ReturnType<typeof animatedFixture>) => {f.world.map.tiles[20 * 40 + 21] = 'water';},
    (f: ReturnType<typeof animatedFixture>) => {f.r.canExpress = false;},
    (f: ReturnType<typeof animatedFixture>) => {f.r.activity!.action = {type: 'sleep', minutes: 60}; f.r.activity!.path = [];},
  ]) {
    const f = animatedFixture(); patch(f); const h = mount(f); h.activate(); assert.equal(record(h).kind, 'fallback'); assert.equal(draw(h).assetId, 'marker');
    assert.deepEqual(draw(h).position, projectStorybook({x: record(h).anchor!.x + .5, y: record(h).anchor!.y + .5})); assert.ok(draw(h).fallback); h.dispose();
  }
  const f = animatedFixture(); f.r.at = {x: NaN, y: 0}; const h = mount(f); h.activate(); assert.equal(h.plan!.unknownResidents[0].id, f.r.id); assert.ok(!h.plan!.draws.some(d => d.selection?.kind === 'person')); h.dispose();
});
test('room/null/world changes discard stale phase and direction without placing people at a doorway', () => {
  const f = animatedFixture(), h = mount(f); h.activate(); f.flags.now = 100; h.tick(); f.room('lodge'); assert.equal(h.plan, null); assert.match(f.frames.at(-1)!.notice, /室内贴图尚未提供/);
  f.r.activity = null; f.room(null); assert.equal(record(h).direction, null); assert.equal(draw(h).assetId, 'marker');
  f.emit(null, false); assert.equal(h.plan, null); f.emit(); assert.equal(record(h).direction, null);
  f.world.id = 'another-synthetic-world'; f.emit(); assert.equal(record(h).direction, null); h.dispose();
});
test('stale/bad clock/bad bounds clear picking and cannot break the original feed; valid evidence can recover', () => {
  const f = animatedFixture(), h = mount(f); h.activate(); const stale = structuredClone(f.snapshot); advance(f); f.r.activity!.travelProgress = .5; f.emit();
  assert.doesNotThrow(() => f.emit(stale)); assert.equal(h.plan, null); assert.match(f.frames.at(-1)!.notice, /stale_snapshot/); f.emit(); assert.ok(h.plan);
  f.flags.now = -1; assert.doesNotThrow(() => h.tick()); assert.equal(h.plan, null); for (const fn of f.picks) fn({x: 0, y: 0}); assert.equal(f.selected.length, 0);
  f.flags.now = 100; h.tick(); assert.ok(h.plan); h.setWindow({x: 0, y: 0, width: 100, height: 100}); assert.equal(h.plan, null); h.setWindow({x: 15, y: 15, width: 12, height: 12}); assert.ok(h.plan); h.dispose();
});
test('late environment failure and surface draw failure clean up or disable only the optional view', () => {
  const f = animatedFixture(); f.environment.subscribeChange = () => {throw Error('synthetic listener failure');}; assert.throws(() => mount(f), /listener failure/); assert.equal(f.feeds.size + f.rooms.size + f.picks.size, 0); assert.equal(f.disposal, 1);
  const g = animatedFixture(), present = g.surface.present; let fail = true;
  g.surface.present = (plan, notice) => {if (plan && fail) {fail = false; throw Error('synthetic draw failure');} present(plan, notice);};
  const h = mount(g); assert.doesNotThrow(() => h.activate()); assert.equal(h.plan, null); assert.match(g.frames.at(-1)!.notice, /绘制失败/); g.emit(); assert.equal(h.plan, null); h.activate(); assert.ok(h.plan); h.dispose();
});
test('atlas/frame mismatch and snapshot mismatch are rejected instead of mixing source pixels and hit geometry', () => {
  const f = animatedFixture(), bad = structuredClone(f.bundle); (bad.manifest.assets[0] as any).frame.foot.x++;
  assert.throws(() => createStorybookAnimatedObserver(f.observer, f.atlas, bad, f.surface, f.environment), /atlas_mismatch/);
  const h = mount(f); h.activate(); assert.throws(() => buildStorybookAnimationPlan(f.snapshot, f.atlas, h.plan!.bounds, {...h.playback!, revision: -1}), /plan_snapshot/);
  assert.throws(() => buildStorybookAnimationPlan(f.snapshot, f.atlas, h.plan!.bounds, {...h.playback!, records: h.playback!.records.map(r => ({...r, spaceId: 'lodge'}))}), /plan_space/); h.dispose();
});
test('actual synthetic submitPlan/stepWorld route reaches pick and settles only in the engine; view cannot make outcomes', () => {
  const f = animatedFixture(); f.r.activity = null; f.world.resources = [{id: 'synthetic-berries', kind: 'bush', at: {x: 24, y: 20}, amount: 5, max: 5, regrowthDays: 0, lastHarvest: 0}]; f.r.knownResources = ['synthetic-berries'];
  const h = mount(f); h.activate(); assert.equal(submitPlan(f.world, {id: 'synthetic-wiring-plan', actorId: f.r.id, actorRevision: f.r.revision, createdAt: f.world.minute, definition: 'action/routine@1', intention: 'Scripted synthetic test, not autonomous behavior', actions: [{type: 'gather', resourceId: 'synthetic-berries', quantity: 1}]}).ok, true);
  const clips = new Set<string>();
  for (let i = 0; i < 100 && (f.r.plan || f.r.activity); i++) {
    stepWorld(f.world, .25); const before = structuredClone(f.world); f.flags.now += 100; f.emit(); h.tick();
    if (record(h).clip) clips.add(record(h).clip!); assert.deepEqual(f.world, before);
    if (record(h).clip === 'pick') {assert.match(draw(h).assetId, /pick/); assert.equal(f.r.activity!.path.length, 0);}
  }
  assert.ok(clips.has('walk') && clips.has('pick')); assert.ok(f.world.events.some(e => e.workCompleted?.action === 'gather')); assert.notEqual(record(h).clip, 'pick'); h.dispose();
});
test('default UI permits only its presentation shell and optional wiring creates no transport, scene/game, timers, storage or model actions', () => {
  for (const file of ['main', 'development-preview', 'scene', 'observer-map', 'isometric-observer']) assert.deepEqual(storybookProductionImportViolations(readFileSync(new URL(`../src/client/${file}.ts`, import.meta.url), 'utf8'), file === 'main'), []);
  for (const file of ['storybook-animated-observer', 'storybook-animation-phaser', 'storybook-phaser', 'storybook-render-plan']) assert.doesNotMatch(readFileSync(new URL(`../src/client/${file}.ts`, import.meta.url), 'utf8'), /\b(?:fetch|EventSource|WebSocket|XMLHttpRequest|submitPlan|stepWorld|setInterval|requestAnimationFrame|setTimeout)\s*\(|new\s+(?:Phaser\.)?(?:Game|Scene)\s*\(|localStorage|process\.env/);
});
test('offscreen residents do not advance limb phase or trigger redraws; returning to the window does not catch up', () => {
  const f = animatedFixture(), h = mount(f); h.activate(); f.flags.now = 100; h.tick(); assert.equal(record(h).elapsedMs, 100);
  h.setWindow({x: 0, y: 0, width: 8, height: 8}); assert.ok(!h.plan!.draws.some(d => d.selection?.kind === 'person')); const frames = f.frames.length;
  for (let i = 0; i < 10; i++) {f.flags.now += 100; h.tick();} assert.equal(record(h).elapsedMs, 100); assert.equal(f.frames.length, frames);
  h.setWindow({x: 16, y: 16, width: 8, height: 8}); assert.equal(record(h).elapsedMs, 100); f.flags.now += 100; h.tick(); assert.equal(record(h).elapsedMs, 200); h.dispose();
});
