/** Development-only presentation lifetime. No transport, world writes or global control API. */
import type {ObserverMap} from './observer-map.js';
import type {StorybookAnimatedObserverHandle} from './storybook-animated-observer.js';
import type {StorybookAnimationBundle} from './storybook-animation-assets.js';
import {bindSyntheticAnimationResident} from './storybook-synthetic-animation-atlas.js';
import {storybookWindow, type StorybookPixelAtlas} from './storybook-render-plan.js';

export interface StorybookDevelopmentPort {
  prepare(): Promise<StorybookPixelAtlas>;
  /** Return one idempotent release, including queued/asynchronous Scene startup. */
  open(observer: ObserverMap, atlas: StorybookPixelAtlas, bundle: StorybookAnimationBundle,
    ready: (view: StorybookAnimatedObserverHandle) => void, tick: () => void, lost: () => void): () => void;
  /** Preserve the prior 2D/2.5D view and input state; do not change logical navigation. */
  suspendOriginal(): () => void;
  status(message: string, state: 'idle' | 'loading' | 'active'): void;
}
export interface StorybookDevelopmentSession {
  readonly state: 'idle' | 'loading' | 'active';
  start(residentId: string): Promise<void>;
  close(message?: string): void;
  dispose(): void;
}
export const STORYBOOK_DEVELOPMENT_NOTICE = '开发专用 · 合成诊断箭头，非正式美术。两张参考 PNG 未取得并核验；仅同一快照。室内与未覆盖内容仍用原视图。';

export function createStorybookDevelopmentSession(observer: ObserverMap, port: StorybookDevelopmentPort): StorybookDevelopmentSession {
  let state: StorybookDevelopmentSession['state'] = 'idle', disposed = false, epoch = 0;
  let residentId = '', worldId = '', view: StorybookAnimatedObserverHandle | null = null;
  let restore: (() => void) | null = null, releaseScene: (() => void) | null = null;
  const releases: Array<() => void> = [];
  const attempt = (fn: (() => void) | null) => {try {fn?.();} catch { /* Release every other owned resource. */ }};
  const status = (message: string) => {try {port.status(message, state);} catch { /* Status UI cannot break the existing feed. */ }};
  const close = (message = '已恢复原观察视图。') => {
    epoch++; state = 'idle';
    const oldView = view, oldScene = releaseScene, oldRestore = restore;
    view = null; releaseScene = null; restore = null;
    attempt(oldView ? () => oldView.dispose() : null); attempt(oldScene); attempt(oldRestore);
    if (!disposed) status(message);
  };
  const valid = () => {
    try {
      const s = observer.currentSnapshot();
      return !!s && s.world.id === worldId && !observer.currentRoom() && Array.isArray(s.world.residents) && s.world.residents.length <= 512 && s.world.residents.filter(r => r.id === residentId).length === 1;
    } catch {return false;}
  };
  const check = () => {
    if (disposed || state !== 'active' || !view) return;
    try {
      if (!valid() || !view.plan) {close('诊断预览记录或绘制不可用，已恢复原视图。'); return;}
      const follow = observer.currentFollow(), snapshot = observer.currentSnapshot();
      if (follow?.status === 'following' && follow.worldId === snapshot?.world.id) {
        const record = view.playback?.records.find(r => r.id === follow.personId);
        if (!record?.anchor || record.spaceId !== null) {close('跟随对象的户外位置不可用，已恢复原视图继续观察同一人。'); return;}
        const next = storybookWindow(snapshot, record.anchor);
        if (JSON.stringify(view.plan.bounds) !== JSON.stringify(next)) view.setWindow(next);
        if (!view.plan) close('诊断窗口不可用，已恢复原视图。');
      }
    } catch {close('诊断预览失败，已恢复原视图。');}
  };
  // Forward the exact same objects/status. Check swallowed renderer failures after acceptance.
  const guarded: ObserverMap = {...observer, subscribe(listener) {return observer.subscribe((snapshot, connected) => {listener(snapshot, connected); check();});}};
  const session: StorybookDevelopmentSession = {
    get state() {return state;},
    async start(id) {
      if (disposed || state !== 'idle') return;
      residentId = id; worldId = observer.currentSnapshot()?.world.id ?? '';
      if (!id || !valid()) {status('请选择当前快照中的一个居民 ID，并在户外启用。'); return;}
      const token = ++epoch; state = 'loading'; status('正在验证内嵌合成图集；原视图仍可使用。');
      try {
        const atlas = await port.prepare();
        if (disposed || epoch !== token) return;
        if (!valid()) {close('加载期间观察对象或房间已改变，保留原视图。'); return;}
        const bundle = bindSyntheticAnimationResident(id);
        const originalRelease = port.suspendOriginal();
        // Switching away from 2.5D can synchronously publish room/follow changes.
        // Do not overwrite cleanup or open a Scene after that cancelled this request.
        if (disposed || epoch !== token || !valid()) {
          attempt(originalRelease);
          if (!disposed && epoch === token) close('原视图切换期间观察范围已改变，保留原视图。');
          return;
        }
        restore = originalRelease;
        const release = port.open(guarded, atlas, bundle, next => {
          if (disposed || epoch !== token) {attempt(() => next.dispose()); return;}
          view = next; state = 'active';
          try {view.activate(); check(); if (state === 'active') status(STORYBOOK_DEVELOPMENT_NOTICE);}
          catch {close('诊断预览启动失败，已恢复原视图。');}
        }, check, () => {if (!disposed && epoch === token) close('诊断场景已关闭，已恢复原视图。');});
        if (disposed || epoch !== token) attempt(release); else releaseScene = release;
      } catch {if (!disposed && epoch === token) close('合成素材或诊断场景不可用，已恢复原视图。');}
    },
    close,
    dispose() {if (disposed) return; disposed = true; close(); while (releases.length) attempt(releases.pop()!);},
  };
  try {
    releases.push(observer.subscribe(() => {if (state !== 'idle' && !valid()) close('世界或绑定对象已改变，已恢复原视图；请重新选择 ID。');}));
    releases.push(observer.subscribeRoom(room => {if (room && state !== 'idle') close('室内贴图未提供，已恢复原视图和原房间。');}));
    releases.push(observer.subscribeFollow(check));
    status(STORYBOOK_DEVELOPMENT_NOTICE);
    return session;
  } catch (error) {session.dispose(); throw error;}
}
