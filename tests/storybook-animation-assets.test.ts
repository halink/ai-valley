import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseStorybookAnimationBundle, storybookAnimationFrame, storybookCelIndex, STORYBOOK_WORLD_DIRECTIONS} from '../src/client/storybook-animation-assets.js';
import {parseStorybookManifest} from '../src/client/storybook-assets.js';
import {animationFixture, animationPin, freezeAnimationFixture} from './helpers/storybook-animation-fixture.js';

test('animation companion preserves strict v1 and requires an explicit optional companion', () => {
  const f = animationFixture(), original = structuredClone(f);
  assert.deepEqual(parseStorybookAnimationBundle(f.atlas, null, animationPin).manifest, parseStorybookManifest(f.atlas, animationPin));
  assert.equal(storybookAnimationFrame(parseStorybookAnimationBundle(f.atlas, null, animationPin), 'resident-walk', 'walk', 'north', 0), null);
  assert.throws(() => parseStorybookManifest({...f.atlas, animation: f.animation}, animationPin), /invalid_storybook_manifest/);
  assert.throws(() => parseStorybookAnimationBundle(f.atlas, undefined, animationPin), /invalid_storybook_animation/);
  freezeAnimationFixture(f);const bundle = parseStorybookAnimationBundle(f.atlas, f.animation, animationPin);
  assert.deepEqual(f, original);assert.ok(Object.isFrozen(bundle.animation?.characters[0].clips.walk.cels[0]));
});
test('2 idle, 6 walking and 4 picking cels each have all four distinct world directions', () => {
  const f = animationFixture(), b = parseStorybookAnimationBundle(f.atlas, f.animation, animationPin), rects = new Set<string>();
  for (const name of ['idle', 'walk', 'pick'] as const) {
    const clip = b.animation!.characters[0].clips[name]!; let elapsed = 0;
    assert.equal(clip.cels.length, {idle: 2, walk: 6, pick: 4}[name]);
    for (let i = 0; i < clip.cels.length; i++) {
      for (const direction of STORYBOOK_WORLD_DIRECTIONS) {
        const result = storybookAnimationFrame(b, 'resident-walk', name, direction, elapsed)!;
        assert.equal(result.frameIndex, i);rects.add(JSON.stringify(result.frame.rect));
        assert.deepEqual(result.frame.foot, {x: 16, y: 60});
      }
      elapsed += clip.cels[i].durationMs;
    }
    assert.equal(storybookCelIndex(clip, elapsed), 0);
    assert.equal(storybookCelIndex(clip, elapsed - .001), clip.cels.length - 1);
  }
  assert.equal(rects.size, 48);
  assert.deepEqual(STORYBOOK_WORLD_DIRECTIONS.map(d => storybookAnimationFrame(b, 'resident-walk', 'idle', d, 0)!.frame.rect.x), [0,32,64,96]);
});
test('idle long hold, fractional walk timing, nullable pick and absent identity stay explicit', () => {
  const f = animationFixture();f.animation.characters[0].clips.pick = null;
  f.animation.characters[0].clips.walk.cels.forEach((c: any) => c.durationMs = 1000/12);
  const b = parseStorybookAnimationBundle(f.atlas, f.animation, animationPin), idle = b.animation!.characters[0].clips.idle;
  assert.equal(storybookCelIndex(idle, 4999.999), 0);assert.equal(storybookCelIndex(idle, 5000), 1);assert.equal(storybookCelIndex(idle, 6000), 0);
  assert.equal(storybookAnimationFrame(b, 'resident-walk', 'pick', 'east', 0), null);
  assert.equal(storybookAnimationFrame(b, 'other', 'walk', 'east', 0), null);
  for (const elapsed of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER+1]) assert.throws(() => storybookCelIndex(idle, elapsed), /elapsedMs/);
});
const changes: Array<[string, (f: ReturnType<typeof animationFixture>) => void]> = [
  ['version', f => f.animation.animationSchemaVersion = 2],
  ['pin', f => f.animation.atlas.packVersion = '1.0.1'],
  ['hash', f => f.animation.atlas.sha256 = 'b'.repeat(64)],
  ['missing direction', f => delete f.atlas.assets[0].frames.northeast],
  ['extra root key', f => (f.animation as any).mirror = true],
  ['missing idle', f => delete f.animation.characters[0].clips.idle],
  ['missing pick rather than explicit null', f => delete f.animation.characters[0].clips.pick],
  ['short walk', f => f.animation.characters[0].clips.walk.cels.pop()],
  ['long idle', f => f.animation.characters[0].clips.idle.cels.push(f.animation.characters[0].clips.idle.cels[0])],
  ['duplicate character', f => f.animation.characters.push(structuredClone(f.animation.characters[0]))],
  ['duplicate binding', f => f.animation.bindings.push({...f.animation.bindings[0]})],
  ['unknown character', f => f.animation.bindings[0].characterId = 'absent'],
  ['empty identity', f => f.animation.bindings[0].residentId = ''],
  ['unknown asset', f => f.animation.characters[0].clips.walk.cels[0].assetId = 'absent'],
  ['static cel', f => f.atlas.assets[0] = {...f.atlas.assets[0], kind: 'static', frame: f.atlas.assets[0].frames.northeast} ],
  ['frame reuse', f => f.animation.characters[0].clips.walk.cels[1].assetId = 'walk-0'],
  ['direction reuse', f => f.atlas.assets[0].frames.northeast = structuredClone(f.atlas.assets[0].frames.southeast)],
  ['foot mismatch', f => f.atlas.assets[0].frames.northeast.foot.x = 15],
  ['wrong footprint', f => f.atlas.assets[0].footprint.width = 2],
  ['wrong anchor', f => f.atlas.assets[0].groundAnchor.x = 0],
  ['walk too fast', f => f.animation.characters[0].clips.walk.cels[0].durationMs = 83],
  ['walk too slow', f => f.animation.characters[0].clips.walk.cels[0].durationMs = 126],
  ['idle too fast', f => f.animation.characters[0].clips.idle.cels[0].durationMs = 50],
  ['pick nonfinite', f => f.animation.characters[0].clips.pick.cels[0].durationMs = Infinity],
  ['sparse cels', f => delete f.animation.characters[0].clips.walk.cels[0]],
  ['excess characters', f => f.animation.characters = Array.from({length:65}, (_,i) => ({...f.animation.characters[0], id:`char-${i}`}))],
  ['excess bindings', f => f.animation.bindings = Array.from({length:513}, (_,i) => ({...f.animation.bindings[0], residentId:`resident-${i}`}))],
];
for (const [label, change] of changes) test(`animation metadata rejects ${label}`, () => {
  const f = animationFixture();change(f);assert.throws(() => parseStorybookAnimationBundle(f.atlas, f.animation, animationPin), /invalid_storybook_(animation|manifest)/);
});
test('companion rejects accessors, symbols and exotic/sparse arrays without executing getters', () => {
  let called = 0;
  for (const path of ['atlas', 'characters.0.id', 'characters.0.clips.walk.cels.1', 'bindings.0.residentId']) {
    const f = animationFixture(), keys = path.split('.'), key = keys.pop()!, target = keys.reduce((o,k) => o[k], f.animation as any);
    Object.defineProperty(target, key, {enumerable: true, get() {called++;throw new Error('getter');}});
    assert.throws(() => parseStorybookAnimationBundle(f.atlas, f.animation, animationPin), /invalid_storybook_animation/);
  }
  assert.equal(called, 0);
  for (const patch of [(x:any) => x[Symbol('s')] = 1, (x:any) => Object.setPrototypeOf(x, {}), (x:any) => Object.defineProperty(x, 'extra', {value:1})]) {
    const f=animationFixture();patch(f.animation.characters);assert.throws(() => parseStorybookAnimationBundle(f.atlas, f.animation, animationPin), /invalid_storybook_animation/);
  }
});
