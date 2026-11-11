/** Tiny DOM/event contract substitute, not browser layout, native focus or accessibility-tree QA. */
import {mountStorybookUIShell} from '../../src/client/storybook-ui-shell.js';
import {animatedFixture} from './storybook-animated-fixture.js';
export function storybookUIHarness(mobile = false) {
  type Listener = {fn: EventListener; capture: boolean};
  class Target {
    listeners = new Map<string, Listener[]>();
    addEventListener(type: string, fn: EventListener, capture = false) {this.listeners.set(type, [...this.listeners.get(type) ?? [], {fn, capture}]);}
    removeEventListener(type: string, fn: EventListener, capture = false) {this.listeners.set(type, (this.listeners.get(type) ?? []).filter(l => l.fn !== fn || l.capture !== capture));}
    emit(type: string, event: any, capture = false) {for (const l of this.listeners.get(type) ?? []) {if (l.capture === capture) l.fn(event); if (event.stopped) return;}}
  }
  class Node extends Target {
    parent: Node | null = null; childNodes: Node[] = [];
    get children(): Element[] {return this.childNodes.filter((node): node is Element => node instanceof Element);}
    append(...nodes: Node[]) {for (const node of nodes) {node.remove(); node.parent = this; this.childNodes.push(node);}}
    insertBefore(node: Node, before: Node) {node.remove(); node.parent = this; this.childNodes.splice(this.childNodes.indexOf(before), 0, node);}
    before(node: Node) {this.parent?.insertBefore(node, this);}
    replaceWith(node: Node) {this.before(node); this.remove();}
    remove() {if (this.parent) {if (this.contains(doc.activeElement)) doc.activeElement = null; this.parent.childNodes = this.parent.childNodes.filter(node => node !== this); this.parent = null;}}
    contains(node: Node | null): boolean {return node === this || this.childNodes.some(child => child.contains(node));}
    get isConnected(): boolean {return doc.contains(this);}
  }
  class Element extends Node {
    attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ''; textContent = ''; id = ''; hidden = false; open = false; type = '';
    constructor(public tagName = 'div') {super();}
    classList = {
      contains: (name: string) => this.className.split(' ').includes(name),
      add: (name: string) => {if (!this.classList.contains(name)) this.className += ' ' + name;},
      remove: (name: string) => {this.className = this.className.split(' ').filter(v => v !== name).join(' ');},
      toggle: (name: string, enabled?: boolean) => {const next = enabled ?? !this.classList.contains(name); next ? this.classList.add(name) : this.classList.remove(name); return next;},
    };
    setAttribute(key: string, value: string) {this.attrs.set(key, value); if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())] = value;}
    getAttribute(key: string) {return this.attrs.get(key) ?? null;} removeAttribute(key: string) {this.attrs.delete(key);}
    matches(selector: string): boolean {
      return selector.split(',').some(part => {part = part.trim();
        if (part.startsWith('#')) return this.id === part.slice(1);
        if (part.startsWith('.')) return this.classList.contains(part.slice(1));
        const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
        if (attr) return attr[2] === undefined ? this.attrs.has(attr[1]) : this.attrs.get(attr[1]) === attr[2];
        return this.tagName === part;
      });
    }
    querySelectorAll(selector: string): Element[] {return this.children.flatMap(node => [...node.matches(selector) ? [node] : [], ...node.querySelectorAll(selector)]);}
    querySelector(selector: string) {return this.querySelectorAll(selector)[0] ?? null;}
    closest(selector: string): Element | null {return this.matches(selector) ? this : this.parent instanceof Element ? this.parent.closest(selector) : null;}
    focus() {
      // Approximate native detach blur and hidden-ancestor refusal, not a browser a11y tree.
      for (let node: Node | null = this; node; node = node.parent) if (node instanceof Element && (node.hidden || node.classList.contains('hidden') && !(node.dataset.panel === 'wild' && app.classList.contains('storybook-ui-active')))) return;
      doc.activeElement = this;
    }
    click() {dispatch('click', this);}
  }
  class Document extends Element {
    activeElement: Element | null = null;
    createElement(tag: string) {return new Element(tag);} createComment() {return new Node();}
    getElementById(id: string) {return this.querySelector('#' + id);}
  }
  const doc = new Document(), win = new Target(), media = Object.assign(new Target(), {matches: mobile});
  Object.assign(win, {matchMedia: () => media});
  const watchers = new Set<Mutation>();
  let failObserve = false;
  class Mutation {constructor(private fn: () => void) {} observe() {if (failObserve) throw Error('synthetic observe failure'); watchers.add(this);} disconnect() {watchers.delete(this);} flush() {this.fn();}}
  function flush() {for (const watcher of watchers) watcher.flush();}
  function dispatch(type: string, target: Element, key?: string) {
    const event = {target, key, stopped: false, defaultPrevented: false, preventDefault() {this.defaultPrevented = true;}, stopImmediatePropagation() {this.stopped = true;}};
    const path: Target[] = []; for (let n: Node | null = target; n; n = n.parent) path.push(n); path.push(win);
    for (const node of [...path].reverse()) {node.emit(type, event, true); if (event.stopped) return event;}
    for (const node of path) {node.emit(type, event); if (event.stopped) return event;}
    flush(); return event;
  }
  const add = (tag: string, parent: Element, attrs: Record<string, string> = {}) => {const node = new Element(tag); for (const [k, v] of Object.entries(attrs)) {if (k === 'id' || k === 'className') node[k] = v; else node.setAttribute(k, v);} parent.append(node); return node;};
  const app = add('div', doc, {id: 'app'}), topbar = add('header', app, {className: 'topbar'}), calendar = add('div', topbar, {className: 'calendar', id: 'calendar'});
  const badge = add('button', topbar, {'data-panel': 'about'}), hud = add('div', app, {id: 'observer-hud'}), state = add('div', hud, {id: 'world-state'});
  state.textContent = 'same status'; const room = add('div', hud, {id: 'room-banner'}), iso = add('div', hud, {className: 'isometric-observer'});
  const selection = add('aside', app, {id: 'selection', className: 'selection hidden'}), profile = add('button', selection, {'data-person': 'unselected'});
  const panel = add('section', app, {id: 'panel', className: 'panel hidden'}), panelHeader = add('div', panel, {className: 'panel-header'});
  const closePanel = add('button', panelHeader, {'data-action': 'closepanel'}), body = add('div', panel, {id: 'panel-body'});
  const dock = add('nav', app, {className: 'dock'}), names = ['people', 'relations', 'conversations', 'places', 'wild', 'chronicle'];
  const buttons = names.map(name => add('button', dock, {'data-panel': name})); buttons[4].classList.add('hidden');
  const controls = add('div', app, {className: 'map-controls'}), origin = app.childNodes.slice(), hudOrigin = hud.childNodes.slice();
  let routes = 0, escaped = 0;
  doc.addEventListener('click', ((event: any) => {
    const target = event.target.closest('[data-panel],[data-person],[data-action]'); if (!target) return;
    if (target.dataset.panel || target.dataset.person) {
      routes++; panel.classList.remove('hidden');
      // Same .dock button contract as the actual main entry, including the more container.
      for (const node of doc.querySelectorAll('.dock').flatMap(d => d.querySelectorAll('button'))) node.classList.toggle('active', node.dataset.panel === (target.dataset.panel ?? 'people'));
      closePanel.focus();
    } else if (target.dataset.action === 'closepanel') {
      panel.classList.add('hidden'); for (const node of buttons) node.classList.remove('active');
    }
  }) as EventListener);
  doc.addEventListener('keydown', ((event: any) => {if (event.key === 'Escape') escaped++;}) as EventListener);
  const f = animatedFixture(); profile.setAttribute('data-person', f.r.id);
  const old = ['document', 'window', 'Element', 'HTMLElement', 'MutationObserver'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries({document: doc, window: win, Element, HTMLElement: Element, MutationObserver: Mutation})) Object.defineProperty(globalThis, name, {configurable: true, value});
  const handle = mountStorybookUIShell(f.observer);
  const find = (selector: string) => {const node = doc.querySelector(selector); if (!node) throw Error('missing ' + selector); return node;};
  return {...f, handle, app, hud, topbar, calendar, badge, selection, profile, panel, panelHeader, closePanel, body, dock, buttons, controls, state, roomBanner: room, iso, doc, media, origin, hudOrigin, watchers, find, flush,
    get routes() {return routes;}, get escaped() {return escaped;},
    open() {find('.storybook-ui-launch').click(); flush();},
    select() {selection.classList.remove('hidden'); flush();},
    resize(isMobile: boolean) {media.matches = isMobile; media.emit('change', {target: media}); flush();},
    escape() {return dispatch('keydown', doc.activeElement ?? app, 'Escape');},
    failObserve() {failObserve = true;},
    remount() {return mountStorybookUIShell(f.observer);},
    cleanup() {handle.dispose(); for (const [name, descriptor] of old) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name];}},
  };
}
