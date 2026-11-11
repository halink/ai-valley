/** Mock DOM/Phaser integration. Never starts a browser, renderer, server or saved world. */
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import ts from 'typescript';
import type {ObserverMap} from '../../src/client/observer-map.js';
import * as session from '../../src/client/storybook-development-session.js';
import * as animation from '../../src/client/storybook-animation-phaser.js';
import * as atlas from '../../src/client/storybook-synthetic-animation-atlas.js';
import {animatedFixture} from './storybook-animated-fixture.js';

export class DevelopmentElement extends EventTarget {
  children: DevelopmentElement[] = []; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; removed = false;
  className = ''; textContent = ''; value = ''; disabled = false; hidden = false; type = ''; width = 0; height = 0;
  setAttribute(k: string, v: string) {this.attrs.set(k, v);} getAttribute(k: string) {return this.attrs.get(k) ?? null;} hasAttribute(k: string) {return this.attrs.has(k);}
  append(...nodes: DevelopmentElement[]) {this.children.push(...nodes);} replaceChildren() {this.children = [];} remove() {this.removed = true;} focus() {}
  closest() {return this;}
  getContext() {return {createImageData: (w: number, h: number) => ({data: new Uint8ClampedArray(w * h * 4)}), putImageData() {}};}
}
class Display {
  children: Display[] = []; parent: Display | null = null; destroyed = false; height = 52; depth = 0; x = 0; y = 0; scale = 1; frame = '';
  setScrollFactor() {return this;} setDepth(v: number) {this.depth = v; return this;} setText() {return this;}
  setPosition(x: number, y: number) {this.x = x; this.y = y; return this;} setScale(v: number) {this.scale = v; return this;} setOrigin() {return this;}
  add(d: Display) {this.children.push(d); d.parent = this; return this;} setTexture(_key: string, frame: string) {this.frame = frame; return this;}
  removeAll(destroy = false) {if (destroy) for (const child of [...this.children]) child.destroy(); this.children = []; return this;}
  sort() {this.children.sort((a, b) => a.depth - b.depth); return this;}
  destroy(children = false) {this.destroyed = true; if (children) this.removeAll(true); if (this.parent) this.parent.children = this.parent.children.filter(d => d !== this);}
}
export function developmentHarness(options: {iso?: boolean; width?: number; height?: number; queued?: boolean; input?: boolean} = {}) {
  const f = animatedFixture(), hud = new DevelopmentElement(), document = new DevelopmentElement(), window = new DevelopmentElement(), isoButton = new DevelopmentElement();
  isoButton.setAttribute('aria-pressed', String(options.iso ?? false));
  Object.assign(document, {getElementById: () => hud, querySelector: () => isoButton, createElement: () => new DevelopmentElement()});
  const oldGlobals = ['document', 'window', 'Element'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of [['document', document], ['window', window], ['Element', DevelopmentElement]] as const) Object.defineProperty(globalThis, name, {configurable: true, value});
  const scenes = new Map<string, Scene>(), pending: Array<() => void> = [], textures = new Set<string>(), objects: Display[] = [], follows = new Set<() => void>();
  const counts = {add: 0, remove: 0, prepare: 0, isoOn: 0, isoOff: 0}, dimensions = {width: options.width ?? 1280, height: options.height ?? 720};
  let failPrepare = false, failAdd = false;
  class Scene {
    key: string; visible = true; active = true; events = new EventEmitter(); input = Object.assign(new EventEmitter(), {enabled: true}); scale = dimensions;
    cameras = {main: {x: 0, y: 0, scrollX: 0, scrollY: 0, zoomX: 1, zoomY: 1, rotation: 0, setBackgroundColor() {}}, cameras: [] as unknown[]};
    textures = {addCanvas(key: string) {textures.add(key); return {add() {return {};}};}, remove(key: string) {textures.delete(key);}};
    add = {container: () => this.object(), text: () => this.object(), image: (_x: number, _y: number, _key: string, frame: string) => {const d = this.object(); d.frame = frame; return d;}};
    sys = {isActive: () => this.active, setActive: (v: boolean) => {this.active = v;}, setVisible: (v: boolean) => {this.visible = v;}};
    constructor(key: string) {this.key = key; this.cameras.cameras = [this.cameras.main];}
    object() {const d = new Display(); objects.push(d); return d;} create() {}
  }
  const manager = {isBooted: true, add(key: string, scene: Scene) {counts.add++; if (failAdd) throw Error('synthetic scene registration'); scenes.set(key, scene); if (options.queued) pending.push(() => scene.create()); else scene.create();}, getScene: (key: string) => scenes.get(key) ?? null,
    remove(key: string) {const s = scenes.get(key); if (s) {counts.remove++; scenes.delete(key); s.events.emit('destroy');}}};
  const original = Object.assign(new Scene('original'), {game: {scene: manager}}); original.input.enabled = options.input ?? true;
  const observer: ObserverMap = {...f.observer, subscribeFollow(fn) {const call = () => fn(null); follows.add(call); call(); return () => {follows.delete(call);};}};
  const iso = {activate() {counts.isoOn++; isoButton.setAttribute('aria-pressed', 'true');}, deactivate() {counts.isoOff++; isoButton.setAttribute('aria-pressed', 'false');}};
  const replacements: Record<string, unknown> = {
    phaser: {Scene}, './storybook-development-preview.css': {}, './storybook-development-session.js': session, './storybook-synthetic-animation-atlas.js': atlas,
    './storybook-animation-phaser.js': {...animation, storybookBrowserAnimationEnvironment: () => f.environment},
    './storybook-texture.js': {prepareStorybookAtlas: async () => {counts.prepare++; if (failPrepare) throw Error('synthetic decoder failure'); return f.atlas;}},
  };
  const source = readFileSync(new URL('../../src/client/storybook-development-preview.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  const module = {exports: {} as {mountStorybookDevelopmentPreview: (observer: ObserverMap, original: unknown, iso: unknown) => {dispose(): void}}};
  new Function('require', 'module', 'exports', code)((name: string) => {if (!(name in replacements)) throw Error('Unstubbed ' + name); return replacements[name];}, module, module.exports);
  const handle = module.exports.mountStorybookDevelopmentPreview(observer, original, iso), tray = hud.children[0], [title, label, start, stop, notice] = tray.children, select = label.children[0];
  return {...f, counts, document, window, hud, tray, title, select, start, stop, notice, original, scenes, textures, objects, follows, isoButton, handle,
    remount: () => module.exports.mountStorybookDevelopmentPreview(observer, original, iso),
    async open(id = f.r.id) {select.value = id; select.dispatchEvent(new Event('change')); start.dispatchEvent(new Event('click')); await Promise.resolve(); await Promise.resolve();},
    flush() {while (pending.length) pending.shift()!();}, failPrepare: () => {failPrepare = true;}, failAdd: () => {failAdd = true;},
    async cleanup() {handle.dispose(); this.flush(); await Promise.resolve(); for (const [name, old] of oldGlobals) {if (old) Object.defineProperty(globalThis, name, old); else delete (globalThis as any)[name];}},
  };
}
