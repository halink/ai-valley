/** Independent, read-only animation state. Not connected to a renderer, feed or simulation.
 * World positions use only the accepted snapshot's first step/progress, never display time.
 */
import type {Vec, World} from '../shared/types.js';
import {roomLayout, roomPath} from '../shared/rooms.js';
import {walkable} from '../world/navigation.js';
import {prepareIsometricResidents, type IsometricResidentSpace} from './isometric-residents.js';
import {residentActivity, type ResidentActivityStatus} from './resident-status.js';
import {storybookAnimationFrame, type StorybookAnimationBundle, type StorybookClipName} from './storybook-animation-assets.js';
import type {StorybookFootprint, StorybookWorldDirection} from './storybook-geometry.js';

export const STORYBOOK_ANIMATION_MAX_GAP_MS = 250;
export interface StorybookPlayback {
  /** Injected monotonic milliseconds. Never Date.now, serverTime or world-minute conversion. */
  nowMs: number; connected: boolean; visible: boolean; reducedMotion: boolean;
}
export type StorybookFreezeReason = 'paused' | 'disconnected' | 'hidden' | 'reduced-motion' | 'long-gap';
export type StorybookAnimationRecord = Readonly<{
  id: string; spaceId: string | null; at: Readonly<Vec> | null; anchor: Readonly<Vec> | null;
  kind: 'frame' | 'fallback' | 'hidden'; reason: string | null;
  activity: Readonly<ResidentActivityStatus> | null; clip: StorybookClipName | null;
  direction: StorybookWorldDirection | null; elapsedMs: number;
  artwork: ReturnType<typeof storybookAnimationFrame>;
}>;
interface Evidence {
  id: string; spaceId: string | null; at: Vec | null; anchor: Vec | null;
  kind: 'eligible' | 'fallback' | 'hidden'; reason: string | null;
  activity: ResidentActivityStatus | null; clip: StorybookClipName | null;
  direction: StorybookWorldDirection | null; token: string; animate: boolean;
}
interface State {evidence: Evidence; elapsedMs: number; fresh: boolean; inView: boolean;}
const point = (p: Vec | undefined | null): p is Vec => !!p && Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y);
const equal = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y;
function direction(offset: Vec): StorybookWorldDirection | null {
  if (offset.x === 0 && offset.y !== 0) return offset.y < 0 ? 'north' : 'south';
  if (offset.y === 0 && offset.x !== 0) return offset.x < 0 ? 'west' : 'east';
  return null;
}
const copyPoint = (p: Vec | null) => p ? Object.freeze({...p}) : null;
function observe(world: World, space: IsometricResidentSpace): Evidence[] {
  // Existing adapter validates space, known location, carrying, death and journey exceptions.
  const records = prepareIsometricResidents(world, space), residents = new Map(world.residents.map(r => [r.id, r]));
  return records.map(record => {
    const r = residents.get(record.id)!, a = r.activity;
    const base: Evidence = {id: r.id, spaceId: space.roomId ?? null, at: null, anchor: null, kind: 'fallback', reason: null, activity: null, clip: null, direction: null, token: '', animate: false};
    if (record.kind === 'hidden') return {...base, kind: 'hidden', reason: record.reason};
    base.at = record.at ? {...record.at} : null; base.anchor = record.kind === 'render' ? {...record.anchor} : record.at ? {...record.at} : null;
    if (record.kind === 'fallback') return {...base, at: record.at ? {...record.at} : null, reason: record.reason};
    try {
      base.activity = {...residentActivity(world, r)};
      const reject = (reason: string): Evidence => ({...base, reason});
      // Generic pleasant standing must not hide body/health or carrying states.
      if (r.status !== 'alive' || !r.canDecide || !r.canExpress || !Number.isFinite(r.health) || r.health <= 0) return reject('生命或自主能力状态未覆盖，请使用原视图。');
      if (world.health?.cases.some(c => c.personId === r.id && c.stage !== 'resolved')) return reject('存在伤病记录，首批动画不以健康待机替代，请使用原视图。');
      if (!['idle', 'walk', 'pick'].includes(record.pose)) return reject(`首批未覆盖 ${record.pose} 姿态，请使用原视图。`);
      if (a && (!Number.isFinite(a.startedAt) || a.startedAt > world.minute || !Number.isFinite(a.remaining) || a.remaining <= 0 || !point(a.target))) return reject('行动时间或目标不完整，不推断行动仍在执行。');
      const carried = world.health?.transports.some(t => t.phase === 'carrying' && t.carrierId === r.id)
        || world.familyRelocation?.agreements.some(c => c.members.some(m => m.escorting && m.caregiverId === r.id))
        || world.residents.some(p => p.status === 'dead' && p.body?.carriedBy === r.id);
      if (carried) return reject('本人正在携运，首批空手动作不适用，请使用原视图。');
      const token = JSON.stringify([space.roomId ?? null, a?.planId ?? null, a?.startedAt ?? null, a?.action ?? null]);
      if (record.pose === 'walk') {
        const path = space.roomId ? a?.room?.path : a?.path, next = path?.[0];
        if (!next || !point(next) || Math.abs(next.x - record.at.x) + Math.abs(next.y - record.at.y) !== 1) return reject('缺少可核实的相邻下一步，不播放行走。');
        if (space.roomId) {
          const building = world.buildings.find(b => b.id === space.roomId);
          if (!building || a?.room?.buildingId !== space.roomId) return {...reject('室内路线与建筑不一致，不播放行走。'), anchor: {...record.at}};
          const layout = roomLayout(world, building), step = roomPath(layout, record.at, next);
          if (space.bounds?.x !== 0 || space.bounds.y !== 0 || space.bounds.width !== layout.width || space.bounds.height !== layout.height || step?.length !== 1) return {...reject('实际室内布局不支持下一步，不播放行走。'), anchor: {...record.at}};
        } else if (!walkable(world, next, record.at)) return {...reject('实际下一步已被阻挡，不播放行走或推算绕路。'), anchor: {...record.at}};
        return {...base, kind: 'eligible', clip: 'walk', direction: direction({x: next.x - record.at.x, y: next.y - record.at.y}), token, animate: true};
      }
      if (base.activity.kind === 'active' && a?.action.type === 'gather') {
        const resourceId = a.action.resourceId, resource = world.resources.find(resource => resource.id === resourceId);
        if (record.pose !== 'pick' || !resource || resource.kind !== 'bush' || !point(resource.at) || !equal(a.target, resource.at) || !Number.isFinite(resource.amount) || resource.amount <= 0 || r.inside || !point(r.at)) return reject('首批只支持真实有量灌木旁的徒手采摘，不替代其他劳动。');
        const offset = {x: resource.at.x - r.at.x, y: resource.at.y - r.at.y}, facing = direction(offset);
        if (Math.abs(offset.x) + Math.abs(offset.y) !== 1 || !facing) return reject('采摘朝向无法从真实相邻资源确认，不猜测朝向。');
        return {...base, kind: 'eligible', clip: 'pick', direction: facing, token, animate: true};
      }
      if (record.pose !== 'idle' || !['voluntary-wait', 'fulfillment-wait', 'decision-wait', 'ready', 'scheduled'].includes(base.activity.kind)) return reject('当前活动没有对应首批动作，不以待机冒充正在劳动。');
      return {...base, kind: 'eligible', clip: 'idle', token: `${token}:${base.activity.kind}`, animate: base.activity.kind === 'voluntary-wait'};
    } catch {return {...base, reason: '活动或路径记录不完整，不推断当前动作。'};}
  });
}
/** One instance per observer view. Keeps only bounded visual phase/facing, never simulation state.
 * Accept only immutable snapshots from the existing accepted feed. Caller must update connection,
 * visibility and reduced-motion flags promptly, even when there is no new snapshot.
 */
export class StorybookAnimationPlayer {
  private states = new Map<string, State>();
  private worldId: string | null = null;
  private revision = -1;
  private minute = -1;
  private paused = true;
  private spaceId: string | null = null;
  private lastMs: number | null = null;
  private running = false;
  constructor(private readonly bundle: StorybookAnimationBundle) {}
  reset(): void {
    this.states.clear(); this.worldId = null; this.revision = -1; this.minute = -1;
    this.paused = true; this.spaceId = null; this.lastMs = null; this.running = false;
  }
  /** Reject stale snapshots before touching phase or retained directions. World/space changes
   * establish a fresh baseline; no history catch-up, guessed entry tile or completion notices.
   */
  accept(world: World, space: IsometricResidentSpace = {}): void {
    if (!world || typeof world.id !== 'string' || !world.id || !Number.isSafeInteger(world.revision) || world.revision < 0 || !Number.isFinite(world.minute) || world.minute < 0 || typeof world.clock?.paused !== 'boolean' || !Array.isArray(world.residents) || world.residents.length > 512) throw new Error('storybook_animation_snapshot');
    if (this.worldId === world.id && (world.revision < this.revision || world.minute < this.minute || world.revision === this.revision && world.minute !== this.minute)) throw new Error('storybook_animation_stale_snapshot');
    const evidence = observe(world, space), spaceId = space.roomId ?? null;
    const baseline = this.worldId !== world.id || this.spaceId !== spaceId;
    if (baseline) this.reset();
    const states = new Map<string, State>();
    for (const e of evidence) {
      const previous = this.states.get(e.id), before = previous?.evidence;
      // A stationary snapshot contains no facing. Retain only a previously observed local
      // direction, and forget it after missing/hidden/fallback records or scene switches.
      const localContinuation = before?.anchor && e.anchor && Math.abs(before.anchor.x - e.anchor.x) + Math.abs(before.anchor.y - e.anchor.y) <= 1;
      if (e.kind === 'eligible' && e.clip === 'idle' && before?.kind === 'eligible' && localContinuation) e.direction = before.direction;
      if (e.kind === 'eligible' && e.clip === 'walk' && before?.clip === 'walk' && world.minute > this.minute && before.anchor && e.anchor && equal(before.anchor, e.anchor)) {
        e.animate = false; e.reason = '新快照未记录步行进展，保持当前脚点与帧，不推算下一步。';
      } else if (e.kind === 'eligible' && e.clip === 'walk' && before?.clip === 'walk' && before.anchor && e.anchor && equal(before.anchor, e.anchor) && !before.animate) {
        e.animate = false; e.reason = before.reason;
      }
      const continuous = before?.kind === 'eligible' && e.kind === 'eligible' && before.clip === e.clip && before.direction === e.direction && before.token === e.token;
      states.set(e.id, {evidence: e, elapsedMs: continuous ? previous!.elapsedMs : 0, fresh: !continuous || previous!.fresh, inView: continuous ? previous!.inView : false});
    }
    this.states = states; this.worldId = world.id; this.revision = world.revision; this.minute = world.minute; this.paused = world.clock.paused; this.spaceId = spaceId;
  }
  sample(control: StorybookPlayback, viewBounds?: Readonly<StorybookFootprint>): Readonly<{worldId: string | null; revision: number; freezeReasons: readonly StorybookFreezeReason[]; records: readonly StorybookAnimationRecord[]}> {
    if (!control || !Number.isFinite(control.nowMs) || control.nowMs < 0 || control.nowMs > Number.MAX_SAFE_INTEGER || this.lastMs !== null && control.nowMs < this.lastMs || ![control.connected, control.visible, control.reducedMotion].every(v => typeof v === 'boolean')) throw new Error('storybook_animation_clock');
    if (viewBounds && (![viewBounds.x, viewBounds.y, viewBounds.width, viewBounds.height].every(Number.isFinite) || viewBounds.width <= 0 || viewBounds.height <= 0)) throw new Error('storybook_animation_view_bounds');
    const reasons: StorybookFreezeReason[] = [];
    if (this.paused) reasons.push('paused');
    if (!control.connected) reasons.push('disconnected');
    if (!control.visible) reasons.push('hidden');
    if (control.reducedMotion) reasons.push('reduced-motion');
    const active = reasons.length === 0, gap = this.lastMs === null ? 0 : control.nowMs - this.lastMs;
    if (gap > STORYBOOK_ANIMATION_MAX_GAP_MS) reasons.push('long-gap');
    const delta = active && this.running && gap <= STORYBOOK_ANIMATION_MAX_GAP_MS ? gap : 0;
    this.lastMs = control.nowMs; this.running = active;
    const records: StorybookAnimationRecord[] = [];
    for (const state of this.states.values()) {
      const e = state.evidence;
      const inView = !viewBounds || !!e.anchor && e.anchor.x >= viewBounds.x && e.anchor.y >= viewBounds.y && e.anchor.x < viewBounds.x + viewBounds.width && e.anchor.y < viewBounds.y + viewBounds.height;
      // Display-window culling freezes local phase too. Returning on screen never catches up.
      if (inView && state.inView && !state.fresh && e.animate && e.kind === 'eligible') state.elapsedMs += delta;
      state.inView = inView;
      state.fresh = false;
      let artwork: ReturnType<typeof storybookAnimationFrame> = null, reason = e.reason;
      if (e.kind === 'eligible') {
        if (!e.direction) reason = '尚无已确认朝向，不使用默认朝向或镜像人物。';
        else artwork = storybookAnimationFrame(this.bundle, e.id, e.clip!, e.direction, state.elapsedMs);
        if (e.direction && !artwork) reason = '此身份或动作没有动画资产，保留原视图。';
      }
      records.push(Object.freeze({id: e.id, spaceId: e.spaceId, at: copyPoint(e.at), anchor: copyPoint(e.anchor), kind: e.kind === 'hidden' ? 'hidden' : artwork ? 'frame' : 'fallback', reason, activity: e.activity ? Object.freeze({...e.activity}) : null, clip: e.clip, direction: e.direction, elapsedMs: state.elapsedMs, artwork}));
    }
    return Object.freeze({worldId: this.worldId, revision: this.revision, freezeReasons: Object.freeze(reasons), records: Object.freeze(records)});
  }
}
