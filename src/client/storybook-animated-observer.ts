/** Explicit development/test wiring. Reads only the caller's existing accepted observation feed. */
import type {ObserverMap} from './observer-map.js';
import type {StorybookSurface, StorybookObserverHandle} from './storybook-observer.js';
import type {StorybookAnimationBundle} from './storybook-animation-assets.js';
import {StorybookAnimationPlayer, type StorybookFreezeReason} from './storybook-animation.js';
import {buildStorybookAnimationPlan, pickStorybookPlan, storybookWindow, type StorybookPixelAtlas, type StorybookPlan} from './storybook-render-plan.js';
import type {StorybookFootprint} from './storybook-geometry.js';

export const STORYBOOK_ANIMATION_PROTOTYPE_NOTICE = '合成动画接线原型 · 非正式美术 · 仅同一快照的局部动作相位，不播放成果；室内及未覆盖状态请用原视图。';
export interface StorybookAnimationEnvironment {
  /** One monotonic time origin for scene ticks and immediate flag/feed changes. */
  now(): number;
  visible(): boolean;
  reducedMotion(): boolean;
  subscribeChange(listener: () => void): () => void;
}
export interface StorybookAnimatedObserverHandle extends StorybookObserverHandle {
  /** Call from the caller-owned scene's preupdate. No additional animation loop is created. */
  tick(): void;
  readonly playback: ReturnType<StorybookAnimationPlayer['sample']> | null;
}
const freezeText: Record<StorybookFreezeReason, string> = {
  paused: '世界停表', disconnected: '连接已断开，显示最后快照', hidden: '页面或原型隐藏',
  'reduced-motion': '减少动态效果', 'long-gap': '显示间隔过长，本段不补播',
};
/** Owns only two existing-source subscriptions, surface input and environment listeners.
 * It never covers the original view, owns navigation, fetches state or starts a scene/game. */
export function createStorybookAnimatedObserver(observer: ObserverMap, atlas: StorybookPixelAtlas, bundle: StorybookAnimationBundle, surface: StorybookSurface, environment: StorybookAnimationEnvironment): StorybookAnimatedObserverHandle {
  // Same hash alone is insufficient: a caller could pair altered frame geometry with old bytes.
  if (JSON.stringify(atlas.manifest) !== JSON.stringify(bundle.manifest)) throw new Error('storybook_animation_atlas_mismatch');
  const player = new StorybookAnimationPlayer(bundle), release: Array<() => void> = [];
  let active = false, disposed = false, connected = false, snapshot = observer.currentSnapshot(), room = observer.currentRoom();
  let bounds: StorybookFootprint | null = null, worldId = snapshot?.world.id, fault: string | null = null;
  let plan: StorybookPlan | null = null, playback: StorybookAnimatedObserverHandle['playback'] = null, signature = '';
  const present = (next: StorybookPlan | null, notice: string) => {
    try {surface.present(next, notice);} catch {
      active = false; plan = null; signature = ''; player.reset(); playback = null;
      try {surface.present(null, '绘本动画原型绘制失败；请使用原视图。');} catch { /* Original source stays usable. */ }
    }
  };
  const render = (rebuild = false) => {
    if (disposed) return;
    try {
      const viewBounds = snapshot && !room ? bounds ?? storybookWindow(snapshot, observer.currentTile()) : undefined;
      playback = player.sample({nowMs: environment.now(), connected, visible: active && environment.visible(), reducedMotion: environment.reducedMotion()}, viewBounds);
      if (!active || !snapshot || room || fault) {
        plan = null; signature = '';
        present(null, fault ? `绘本动画原型不可用：${fault} 请使用原视图。` : room ? '绘本室内贴图尚未提供；请使用原视图，不把室内居民挪到门口。' : !active ? STORYBOOK_ANIMATION_PROTOTYPE_NOTICE + ' 未启用。' : '等待现有观察入口的快照；原视图保持可用。');
        return;
      }
      const nextSignature = JSON.stringify([viewBounds, playback.freezeReasons, playback.records.filter(r => r.anchor && viewBounds && r.anchor.x >= viewBounds.x && r.anchor.y >= viewBounds.y && r.anchor.x < viewBounds.x + viewBounds.width && r.anchor.y < viewBounds.y + viewBounds.height).map(r => [r.id, r.kind, r.reason, r.artwork?.assetId, r.direction])]);
      if (!rebuild && signature === nextSignature && plan) return;
      const next = buildStorybookAnimationPlan(snapshot, atlas, bounds ?? storybookWindow(snapshot, observer.currentTile()), playback);
      plan = next; signature = nextSignature;
      present(next, STORYBOOK_ANIMATION_PROTOTYPE_NOTICE + playback.freezeReasons.map(r => ` ${freezeText[r]}。`).join('') + ` 世界分钟 ${next.minute}；版本 ${next.revision}。`);
    } catch (error) {
      plan = null; signature = ''; playback = null;
      present(null, `绘本动画原型不可用：${error instanceof Error ? error.message : '记录不受支持'} 请使用原视图。`);
    }
  };
  const accept = () => {
    fault = null;
    try {
      if (snapshot && !room) player.accept(snapshot.world);
      else {player.reset(); playback = null;}
    } catch (error) {fault = error instanceof Error ? error.message : '快照不受支持';}
    render(true);
  };
  const handle: StorybookAnimatedObserverHandle = {
    activate() {if (disposed) return; active = true; accept();},
    deactivate() {if (disposed) return; active = false; render(true);},
    tick() {if (!disposed && active && environment.visible()) render();},
    setWindow(value) {if (disposed) return; bounds = {...value}; render(true);},
    get plan() {return plan;}, get playback() {return playback;},
    dispose() {if (disposed) return; disposed = true; active = false; plan = null; playback = null; player.reset(); while (release.length) {try {release.pop()!();} catch { /* Release other owned resources. */ } }},
  };
  release.push(() => surface.dispose());
  try {
    release.push(surface.subscribePick((at, original) => {
      if (disposed || !active || !environment.visible() || !plan) return;
      const hit = pickStorybookPlan(plan, atlas, original?.screen ?? at, original?.camera ?? {origin: {x: 0, y: 0}, zoom: 1});
      if (hit?.selection) observer.select(hit.selection);
    }));
    release.push(observer.subscribe((value, status) => {
      if (disposed) return;
      if (value?.world.id !== worldId) {bounds = null; worldId = value?.world.id;}
      snapshot = value; connected = status; accept();
    }));
    release.push(observer.subscribeRoom(value => {if (disposed) return; room = value; accept();}));
    release.push(environment.subscribeChange(() => render()));
    accept(); return handle;
  } catch (error) {handle.dispose(); throw error;}
}
