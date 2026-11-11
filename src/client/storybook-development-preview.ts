/** Serve-only diagnostic controls; uses a second Scene in the existing Game, not another world. */
import Phaser from 'phaser';
import type {ObserverMap} from './observer-map.js';
import type {IsometricObserverHandle} from './isometric-observer.js';
import {prepareStorybookAtlas} from './storybook-texture.js';
import {syntheticAnimationManifest, syntheticAnimationPin, syntheticAnimationAtlasBytes} from './storybook-synthetic-animation-atlas.js';
import {mountStorybookAnimationPrototype, storybookBrowserAnimationEnvironment} from './storybook-animation-phaser.js';
import {createStorybookDevelopmentSession, type StorybookDevelopmentSession} from './storybook-development-session.js';
import type {StorybookAnimatedObserverHandle} from './storybook-animated-observer.js';
import './storybook-development-preview.css';

const mounted = new WeakMap<ObserverMap, {dispose(): void}>();
let sequence = 0;
/** No caller can activate this with query parameters in the production dependency graph. */
export function mountStorybookDevelopmentPreview(observer: ObserverMap, original: Phaser.Scene, iso: IsometricObserverHandle): {dispose(): void} {
  const previous = mounted.get(observer); if (previous) return previous;
  let disposed = false, session: StorybookDevelopmentSession | null = null;
  const releases: Array<() => void> = [];
  const tray = document.createElement('section'); tray.className = 'storybook-development-controls';
  tray.setAttribute('aria-label', '开发专用合成绘本诊断预览');
  const title = document.createElement('strong'); title.textContent = '开发专用 · 绘本诊断（非正式美术）';
  const label = document.createElement('label'); label.textContent = '动画绑定原居民 ID：';
  const select = document.createElement('select'); select.setAttribute('aria-label', '选择动画绑定的原居民 ID'); label.append(select);
  const start = document.createElement('button'); start.type = 'button'; start.textContent = '打开合成诊断预览'; start.disabled = true;
  const stop = document.createElement('button'); stop.type = 'button'; stop.textContent = '返回原视图'; stop.hidden = true;
  const notice = document.createElement('p'); notice.setAttribute('role', 'status');
  tray.append(title, label, start, stop, notice);
  const listen = (target: EventTarget, type: string, fn: EventListener, capture = false) => {target.addEventListener(type, fn, capture); releases.push(() => target.removeEventListener(type, fn, capture));};
  const dispose = () => {
    if (disposed) return; disposed = true; session?.dispose();
    while (releases.length) {try {releases.pop()!();} catch { /* Finish releasing other owned listeners. */ }}
    tray.remove(); mounted.delete(observer);
  };
  try {
    document.getElementById('observer-hud')!.append(tray);
    let listedWorld = '', listSignature = '';
    const refreshChoices = () => {
      const snapshot = observer.currentSnapshot(), residents = Array.isArray(snapshot?.world.residents) ? snapshot.world.residents : [];
      const signature = JSON.stringify([snapshot?.world.id, residents.slice(0, 513).map(r => [r.id, r.name])]);
      if (signature !== listSignature) {
        const selected = listedWorld === snapshot?.world.id ? select.value : '';
        select.replaceChildren();
        const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '请选择，不按顺序猜测角色'; select.append(placeholder);
        if (residents.length <= 512) for (const r of residents) {const option = document.createElement('option'); option.value = r.id; option.textContent = `${r.name} · ${r.id}`; select.append(option);}
        select.value = residents.some(r => r.id === selected) ? selected : '';
        listedWorld = snapshot?.world.id ?? ''; listSignature = signature;
      }
      start.disabled = session?.state !== 'idle' || !select.value || !snapshot || !!observer.currentRoom() || residents.length > 512;
    };
    session = createStorybookDevelopmentSession(observer, {
      prepare: () => prepareStorybookAtlas(syntheticAnimationManifest, syntheticAnimationPin, syntheticAnimationAtlasBytes()),
      status(message, state) {notice.textContent = message; stop.hidden = state === 'idle'; select.disabled = state !== 'idle'; refreshChoices();},
      suspendOriginal() {
        const input = original.input;
        if (!input || !original.game?.scene.isBooted || !original.sys.isActive()) throw new Error('storybook_original_not_ready');
        const wasIso = document.querySelector('[data-view="iso"]')?.getAttribute('aria-pressed') === 'true';
        const wasInput = input.enabled;
        let restored = false;
        const restore = () => {if (restored) return; restored = true; input.enabled = wasInput; if (wasIso) iso.activate();};
        try {if (wasIso) iso.deactivate(); input.enabled = false; return restore;}
        catch (error) {restore(); throw error;}
      },
      open(source, atlas, bundle, ready, tick, lost) {
        const game = original.game, key = 'storybook-development-' + (++sequence);
        let closed = false, scene: Phaser.Scene | null = null, view: StorybookAnimatedObserverHandle | null = null;
        const onLost = () => {if (!closed) lost();};
        const release = () => {
          if (closed) return; closed = true;
          try {view?.dispose();} catch { /* Continue removing the caller-owned Scene. */ } view = null;
          if (scene) {
            scene.events.off('preupdate', tick); scene.events.off('shutdown', onLost); scene.events.off('destroy', onLost);
            scene.sys.setVisible(false); scene.sys.setActive(false); scene.input.enabled = false;
          }
          // Removing from inside shutdown/destroy/preupdate must not re-enter Scene teardown.
          queueMicrotask(() => {if (game.scene?.getScene(key)) game.scene.remove(key);});
        };
        class DiagnosticScene extends Phaser.Scene {
          constructor() {super(key);}
          create() {
            scene = this;
            if (closed) {this.sys.setVisible(false); this.sys.setActive(false); this.input.enabled = false; queueMicrotask(() => {if (game.scene?.getScene(key)) game.scene.remove(key);}); return;}
            try {
              this.cameras.main.setBackgroundColor('#f4ecd9');
              const width = Math.floor(this.scale.width) - 32, height = Math.floor(this.scale.height) - 280;
              const environment = storybookBrowserAnimationEnvironment();
              view = mountStorybookAnimationPrototype(this, source, atlas, bundle, {x: 16, y: 160, width, height}, {
                ...environment, subscribeChange: listener => environment.subscribeChange(() => {listener(); tick();}),
              });
              this.events.on('preupdate', tick); this.events.on('shutdown', onLost); this.events.on('destroy', onLost);
              ready(view);
            } catch {release(); lost();}
          }
        }
        try {game.scene.add(key, new DiagnosticScene(), true); return release;}
        catch (error) {release(); throw error;}
      },
    });
    releases.push(observer.subscribe(refreshChoices)); releases.push(observer.subscribeRoom(refreshChoices));
    listen(select, 'change', refreshChoices);
    listen(start, 'click', () => {void session!.start(select.value);});
    listen(stop, 'click', () => session!.close());
    // Existing document routes keep their original selection, profile, follow and room semantics.
    // Window capture precedes the existing 2.5D document capture handler. Restoration
    // therefore happens before that handler decides which camera should receive a route.
    listen(window, 'click', event => {
      if (session!.state === 'idle' || !(event.target instanceof Element)) return;
      const target = event.target;
      const control = target.closest<HTMLElement>('[data-view],[data-action],[data-enter],[data-locate],[data-tile],[data-region],[data-project],[data-animal-map],[data-panel]');
      if (observer.isFullMapTarget(target) || control?.hasAttribute('data-view') || control?.hasAttribute('data-enter') || control?.hasAttribute('data-locate') || control?.hasAttribute('data-tile') || control?.hasAttribute('data-region') || control?.hasAttribute('data-project') || control?.hasAttribute('data-animal-map') || ['home', 'zoomin', 'zoomout', 'trade-station', 'exitroom'].includes(control?.dataset.action ?? '') || control?.dataset.panel === 'atlas') session!.close('该镜头或室内入口仍使用原视图。');
    }, true);
    listen(document, 'keydown', event => {if (session!.state !== 'idle' && (event as KeyboardEvent).key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); session!.close(); start.focus();}}, true);
    listen(window, 'resize', () => {if (session!.state !== 'idle') session!.close('画幅已改变，已恢复原视图；可重新打开诊断预览。');});
    const onOriginalLost = () => dispose(); original.events.on('shutdown', onOriginalLost); releases.push(() => original.events.off('shutdown', onOriginalLost)); original.events.on('destroy', onOriginalLost); releases.push(() => original.events.off('destroy', onOriginalLost));
    const handle = {dispose}; mounted.set(observer, handle); refreshChoices(); return handle;
  } catch (error) {dispose(); throw error;}
}
