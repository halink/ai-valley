/** Independent CPU counterexamples. Synthetic metadata only; no PNGs or runtime inputs. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {StorybookAnimationPlayer} from '../src/client/storybook-animation.js';
import {parseStorybookAnimationBundle, storybookAnimationFrame} from '../src/client/storybook-animation-assets.js';
import {parseStorybookManifest} from '../src/client/storybook-assets.js';
import {isometricResidentsFixture, residentAction} from '../scripts/isometric-residents-fixture.js';
import {animationFixture, animationPin} from './helpers/storybook-animation-fixture.js';

function setup() {
  const f = isometricResidentsFixture();
  const metadata = animationFixture(f.world.residents.map(r => r.id));
  const player = new StorybookAnimationPlayer(parseStorybookAnimationBundle(metadata.atlas, metadata.animation, animationPin));
  player.accept(f.world);
  const sample = (nowMs: number, id = f.walk.id) => player.sample({nowMs, connected: true, visible: true, reducedMotion: false}).records.find(r => r.id === id)!;
  return {...f, metadata, player, sample};
}

test('review: revision-only updates must not restart a confirmed stalled walk', () => {
  const f = setup(); f.sample(0); assert.equal(f.sample(100).elapsedMs, 100);
  f.world.minute += .25; f.world.revision++; f.player.accept(f.world);
  assert.equal(f.sample(200).elapsedMs, 100);
  f.world.revision++; f.player.accept(f.world);
  assert.equal(f.sample(300).elapsedMs, 100);
  assert.match(f.sample(400).reason!, /未记录步行进展/);
  f.walk.activity!.travelProgress = .75; f.world.revision++; f.player.accept(f.world);
  assert.equal(f.sample(500).elapsedMs, 200);
  assert.deepEqual(f.sample(500).anchor, {x: 6.75, y: 3});
});

test('review: an indoor blocked first step cannot retain a speculative interpolated anchor', () => {
  const f = setup();
  residentAction(f.world, f.sleeper, {type: 'wait', minutes: 10});
  f.sleeper.roomAt = {x: 5, y: 6};
  assert.ok(f.layout.blocked.some(p => p.x === 6 && p.y === 6));
  f.sleeper.activity!.room = {buildingId: f.home.id, mode: 'work', target: {x: 6, y: 6}, path: [{x: 6, y: 6}], progress: .75};
  f.player.accept(f.world, {roomId: f.home.id, bounds: {x: 0, y: 0, width: f.layout.width, height: f.layout.height}});
  const record = f.sample(0, f.sleeper.id);
  assert.equal(record.kind, 'fallback'); assert.equal(record.artwork, null);
  assert.match(record.reason!, /布局不支持/);
  assert.deepEqual(record.at, {x: 5, y: 6});
  assert.deepEqual(record.anchor, record.at);
});

test('review: hidden residents forget old heading rather than reusing it after a return', () => {
  const f = setup(); assert.equal(f.sample(0).direction, 'east');
  f.walk.inside = f.home.id; f.world.revision++; f.player.accept(f.world);
  assert.equal(f.sample(100).kind, 'hidden');
  f.walk.inside = null; f.walk.activity = null; f.walk.plan = null; f.world.revision++; f.player.accept(f.world);
  const back = f.sample(200); assert.equal(back.kind, 'fallback'); assert.equal(back.direction, null); assert.equal(back.artwork, null);
});

test('review: rejected duplicate-resident snapshots and clocks leave accepted state untouched', () => {
  const f = setup(); f.sample(0); const original = f.sample(100);
  const duplicate = structuredClone(f.world); duplicate.revision++; duplicate.residents.push(structuredClone(duplicate.residents[0]));
  assert.throws(() => f.player.accept(duplicate), /duplicate/);
  assert.throws(() => f.player.sample({nowMs: 200, connected: 'yes' as any, visible: true, reducedMotion: false}), /clock/);
  const next = f.sample(200); assert.equal(next.elapsedMs, 200); assert.deepEqual(next.anchor, original.anchor);
});

test('review: detached companion identity and duration survive caller mutation', () => {
  const f = animationFixture(); const parsed = parseStorybookAnimationBundle(f.atlas, f.animation, animationPin);
  f.animation.bindings[0].characterId = 'replaced'; f.animation.characters[0].clips.walk.cels[0].durationMs = 125;
  f.atlas.assets[2].frames.southeast.rect.x = 0;
  const frame = storybookAnimationFrame(parsed, 'resident-walk', 'walk', 'east', 100)!;
  assert.equal(frame.frameIndex, 1); assert.equal(frame.characterId, 'synthetic-person');
  assert.ok(Object.isFrozen(parsed.animation!.bindings[0]));
});

test('review: both static-only and animated reads keep strict original v1 object shapes', () => {
  const f = animationFixture();
  const original = parseStorybookManifest(f.atlas, animationPin);
  for (const companion of [null, f.animation]) {
    const parsed = parseStorybookAnimationBundle(f.atlas, companion, animationPin);
    assert.deepEqual(parsed.manifest, original);
    assert.throws(() => parseStorybookAnimationBundle({...f.atlas, animationSchemaVersion: 1}, companion, animationPin), /manifest/);
  }
});

test('review: null pick is a missing action, never substituted with idle or walking', () => {
  const f = animationFixture(); f.animation.characters[0].clips.pick = null;
  const b = parseStorybookAnimationBundle(f.atlas, f.animation, animationPin);
  for (const direction of ['north', 'east', 'south', 'west'] as const) {
    assert.equal(storybookAnimationFrame(b, 'resident-walk', 'pick', direction, 100), null);
    assert.ok(storybookAnimationFrame(b, 'resident-walk', 'walk', direction, 100));
  }
});

test('review: removing only some freeze causes cannot resume phase; last cause removal does not catch up', () => {
  const f = setup(); f.sample(0); assert.equal(f.sample(100).elapsedMs, 100);
  f.world.clock.paused = true; f.player.accept(f.world);
  const stopped = f.player.sample({nowMs: 200, connected: false, visible: false, reducedMotion: true});
  assert.deepEqual(stopped.freezeReasons, ['paused', 'disconnected', 'hidden', 'reduced-motion']);
  assert.equal(stopped.records.find(r => r.id === f.walk.id)!.elapsedMs, 100);
  f.world.clock.paused = false; f.player.accept(f.world);
  for (const [nowMs, connected, visible, reducedMotion] of [[300, true, false, true], [400, true, true, true], [500, true, true, false]] as const) {
    const out = f.player.sample({nowMs, connected, visible, reducedMotion});
    assert.equal(out.records.find(r => r.id === f.walk.id)!.elapsedMs, 100);
  }
  assert.equal(f.sample(600).elapsedMs, 200);
});

test('review: game-time jumps cannot fast-forward the injected display phase or extrapolate a route', () => {
  const f = setup(); f.sample(0);
  f.world.minute += 100000; f.world.revision++; f.walk.activity!.travelProgress = .75;
  f.player.accept(f.world);
  const record = f.sample(100);
  assert.equal(record.clip, 'walk'); assert.equal(record.elapsedMs, 100);
  assert.deepEqual(record.anchor, {x: 6.75, y: 3});
  assert.equal(record.artwork!.frameIndex, 1);
});
