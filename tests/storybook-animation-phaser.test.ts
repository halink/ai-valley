/** Mocked Phaser/browser contracts only; no browser rendering, layout or performance claims. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import type Phaser from 'phaser';
import {mountStorybookAnimationPrototype, storybookBrowserAnimationEnvironment} from '../src/client/storybook-animation-phaser.js';
import {mountStorybookPrototype} from '../src/client/storybook-phaser.js';
import {animatedFixture} from './helpers/storybook-animated-fixture.js';
import {densityAtlas} from './helpers/storybook-density-fixture.js';
import {parseStorybookAnimationBundle} from '../src/client/storybook-animation-assets.js';
class Display {
  children: Display[] = []; parent: Display | null = null; destroyed = false; depth = 0; x = 0; y = 0; scale = 1; origin = {x: 0, y: 0}; height = 52; frame = ''; text = ''; textureChanges = 0;
  setScrollFactor() {return this;} setDepth(v: number) {this.depth = v; return this;} setText(v: string) {this.text = v; return this;}
  setPosition(x: number, y: number) {this.x = x; this.y = y; return this;} setScale(v: number) {this.scale = v; return this;}
  setOrigin(x: number, y: number) {this.origin = {x, y}; return this;} add(d: Display) {this.children.push(d); d.parent = this; return this;}
  setTexture(_key: string, frame: string) {this.frame = frame; this.textureChanges++; return this;}
  removeAll(destroy = false) {if (destroy) for (const child of [...this.children]) child.destroy(); this.children = []; return this;}
  sort() {this.children.sort((a, b) => a.depth - b.depth); return this;}
  destroy(children = false) {this.destroyed = true; if (children) this.removeAll(true); if (this.parent) this.parent.children = this.parent.children.filter(d => d !== this);}
}
function sceneFixture() {
  const f = animatedFixture(), events = new EventEmitter(), input = new EventEmitter(), textures = new Set<string>(), objects: Display[] = [], frames: string[] = [];
  const camera = {x: 0, y: 0, scrollX: 0, scrollY: 0, zoomX: 1, zoomY: 1, rotation: 0};
  const scene = {cameras: {main: camera, cameras: [camera]}, input, events,
    textures: {addCanvas(key: string) {textures.add(key); return {setFilter(mode: number) {assert.equal(mode, 0); return this;}, add(name: string) {frames.push(name); return {};}};}, remove(key: string) {textures.delete(key);}},
    add: {container() {const d = new Display(); objects.push(d); return d;}, text() {const d = new Display(); objects.push(d); return d;}, image(x: number, y: number, _key: string, frame: string) {const d = new Display(); d.x = x; d.y = y; d.frame = frame; objects.push(d); return d;}},
  } as unknown as Phaser.Scene;
  return {...f, scene, events, input, textures, objects, frames};
}
function browserFixture() {
  const ds = Object.getOwnPropertyDescriptor(globalThis, 'document'), ws = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const documentEvents = new EventEmitter(), mediaEvents = new EventEmitter();
  const media = {matches: false, addEventListener: (name: string, fn: () => void) => mediaEvents.on(name, fn), removeEventListener: (name: string, fn: () => void) => mediaEvents.off(name, fn)};
  const doc = {visibilityState: 'visible', createElement: () => ({width: 0, height: 0, getContext: () => ({createImageData: (w: number, h: number) => ({data: new Uint8ClampedArray(w * h * 4)}), putImageData() {}})}), addEventListener: (name: string, fn: () => void) => documentEvents.on(name, fn), removeEventListener: (name: string, fn: () => void) => documentEvents.off(name, fn)};
  Object.defineProperty(globalThis, 'document', {configurable: true, value: doc}); Object.defineProperty(globalThis, 'window', {configurable: true, value: {matchMedia: (query: string) => {assert.equal(query, '(prefers-reduced-motion: reduce)'); return media;}}});
  return {doc, media, documentEvents, mediaEvents, restore() {for (const [name, old] of [['document', ds], ['window', ws]] as const) {if (old) Object.defineProperty(globalThis, name, old); else delete (globalThis as any)[name];}}};
}
for (const [width, height] of [[1440, 900], [1280, 720], [390, 844]]) for (const density of [1, 2]) {
  test(`mocked ${width}x${height} ${density}x adapter updates actual frames without allocating new ground/images each animation tick`, () => {
    const browser = browserFixture(); try {
      const f = sceneFixture(), viewport = {x: 0, y: 0, width, height};
      if (density !== 1) {
        f.atlas = densityAtlas(f.atlas, density);
        f.bundle = parseStorybookAnimationBundle(f.atlas.manifest, {...f.bundle.animation, atlas: {...f.bundle.animation!.atlas, sha256: f.atlas.manifest.atlas.sha256}}, {packId: f.atlas.manifest.packId, packVersion: f.atlas.manifest.packVersion});
      }
      const h = mountStorybookAnimationPrototype(f.scene, f.observer, f.atlas, f.bundle, viewport, f.environment); assert.equal(h.plan, null); h.activate();
      assert.equal(mountStorybookAnimationPrototype(f.scene, f.observer, f.atlas, f.bundle, viewport, f.environment), h);
      assert.throws(() => mountStorybookPrototype(f.scene, f.observer, f.atlas, viewport), /already_owned/);
      const group = f.objects[0], count = f.objects.length, ground = group.children[0], person = group.children.at(-1)!;
      assert.equal(person.scale, 1 / density);
      const first = {x: person.x, y: person.y, origin: {...person.origin}, scale: group.scale, gx: group.x, gy: group.y};
      f.flags.now = 50; f.events.emit('preupdate'); assert.equal(person.textureChanges, 0);
      f.flags.now = 100; f.events.emit('preupdate'); assert.equal(person.textureChanges, 1); assert.equal(person.frame, h.plan!.draws.at(-1)!.assetId + ':southeast');
      assert.equal(f.objects.length, count); assert.equal(group.children[0], ground); assert.deepEqual({x: person.x, y: person.y, origin: person.origin, scale: group.scale, gx: group.x, gy: group.y}, first);
      const d = h.plan!.draws.at(-1)!, r = d.frame.rect; let pixel = {x: 0, y: 0}; let found = false;
      for (let y = 0; y < r.height && !found; y++) for (let x = 0; x < r.width; x++) if (f.atlas.pixels[((r.y + y) * f.atlas.width + r.x + x) * 4 + 3]) {pixel = {x, y}; found = true; break;}
      f.atlas.pixels.fill(0); f.input.emit('pointerup', {x: (d.topLeft.x + (pixel.x + .5) * d.scale) * group.scale + group.x, y: (d.topLeft.y + (pixel.y + .5) * d.scale) * group.scale + group.y}); assert.equal(f.selected[0]!.id, f.r.id);
      f.r.residency = 'outside'; f.world.revision++; f.emit(); assert.ok(person.destroyed); assert.equal(group.children.length, h.plan!.draws.length);
      f.events.emit('shutdown'); assert.equal(f.events.listenerCount('preupdate') + f.events.listenerCount('shutdown') + f.events.listenerCount('destroy') + f.input.listenerCount('pointerup') + f.feeds.size + f.rooms.size + f.changes.size + f.textures.size, 0); assert.ok(f.objects.every(d => d.destroyed)); h.dispose();
    } finally {browser.restore();}
  });
}
test('mock camera changes disable only this surface and late scene registration failures release animation/observer listeners', () => {
  const browser = browserFixture(); try {
    const f = sceneFixture(), h = mountStorybookAnimationPrototype(f.scene, f.observer, f.atlas, f.bundle, {x: 0, y: 0, width: 1280, height: 720}, f.environment); h.activate();
    Object.assign(f.scene.cameras.main, {scrollX: 1}); f.events.emit('preupdate'); assert.equal(h.plan, null); assert.equal(f.objects[0].children.length, 0); h.dispose();
    for (const fail of ['preupdate', 'shutdown', 'destroy']) {
      const g = sceneFixture(), on = g.events.on.bind(g.events); g.events.on = ((name: string, fn: (...args: any[]) => void) => {if (name === fail) throw Error('synthetic registration'); return on(name, fn);}) as any;
      assert.throws(() => mountStorybookAnimationPrototype(g.scene, g.observer, g.atlas, g.bundle, {x: 0, y: 0, width: 1280, height: 720}, g.environment), /synthetic registration/);
      assert.equal(g.events.listenerCount('preupdate') + g.events.listenerCount('shutdown') + g.input.listenerCount('pointerup') + g.feeds.size + g.rooms.size + g.changes.size + g.textures.size, 0); assert.ok(g.objects.every(d => d.destroyed));
    }
  } finally {browser.restore();}
});
test('browser environment reads actual flags, immediate events and one monotonic clock, then releases both listeners', () => {
  const browser = browserFixture(); try {
    const env = storybookBrowserAnimationEnvironment(); let changes = 0; const release = env.subscribeChange(() => changes++);
    assert.equal(env.visible(), true); assert.equal(env.reducedMotion(), false); assert.ok(Number.isFinite(env.now()));
    browser.doc.visibilityState = 'hidden'; browser.documentEvents.emit('visibilitychange'); assert.equal(env.visible(), false);
    browser.media.matches = true; browser.mediaEvents.emit('change'); assert.equal(env.reducedMotion(), true); assert.equal(changes, 2);
    release(); release(); assert.equal(browser.documentEvents.listenerCount('visibilitychange') + browser.mediaEvents.listenerCount('change'), 0);
    browser.media.addEventListener = () => {throw Error('synthetic media listener');}; assert.throws(() => env.subscribeChange(() => changes++), /media listener/); assert.equal(browser.documentEvents.listenerCount('visibilitychange'), 0);
  } finally {browser.restore();}
});
