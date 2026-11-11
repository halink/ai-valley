/** Synthetic observation/clock harness. No transport, browser, real save or model. */
import type {Snapshot, Vec} from '../../src/shared/types.js';
import type {ObserverMap, ObserverSelection} from '../../src/client/observer-map.js';
import type {StorybookSurface} from '../../src/client/storybook-observer.js';
import type {StorybookPlan} from '../../src/client/storybook-render-plan.js';
import type {StorybookAnimationEnvironment} from '../../src/client/storybook-animated-observer.js';
import {createWorld} from '../../src/world/seed.js';
import {bindSyntheticAnimationResident, syntheticAnimationAtlasPixels, SYNTHETIC_ANIMATION_WIDTH, SYNTHETIC_ANIMATION_HEIGHT} from '../../src/client/storybook-synthetic-animation-atlas.js';
export function animatedFixture() {
  const world = createWorld(5401), r = world.residents[0];
  world.clock.paused = false; world.residents = [r]; world.buildings = []; world.resources = []; world.events = []; world.graves = [];
  world.map = {width: 40, height: 40, tiles: Array(1600).fill('grass'), entrance: {x: 0, y: 0}, name: 'Synthetic animation wiring'};
  Object.assign(r, {at: {x: 20, y: 20}, inside: null, roomAt: null, homeId: null, knownResources: [], knownBuildings: [], knownPeople: [], memories: [], hunger: 0, energy: 100, health: 100, plan: null, activity: null});
  r.activity = {action: {type: 'wait', minutes: 5}, target: {x: 21, y: 20}, path: [{x: 21, y: 20}], travelProgress: .25, startedAt: world.minute, remaining: 5, planId: 'synthetic-walk', definition: 'action/routine@1'};
  const snapshot: Snapshot = {world, serverTime: 'synthetic', version: 'synthetic', capabilities: {active: [], pending: []}};
  const bundle = bindSyntheticAnimationResident(r.id);
  const atlas = {manifest: bundle.manifest, width: SYNTHETIC_ANIMATION_WIDTH, height: SYNTHETIC_ANIMATION_HEIGHT, pixels: syntheticAnimationAtlasPixels()};
  let current: Snapshot | null = snapshot, room: string | null = null, disposal = 0;
  const feeds = new Set<(snapshot: Snapshot | null, connected: boolean) => void>(), rooms = new Set<(id: string | null) => void>(), picks = new Set<(at: Vec) => void>(), changes = new Set<() => void>();
  const flags = {now: 0, visible: true, reducedMotion: false};
  const environment: StorybookAnimationEnvironment = {now: () => flags.now, visible: () => flags.visible, reducedMotion: () => flags.reducedMotion, subscribeChange(fn) {changes.add(fn); return () => {changes.delete(fn);};}};
  const selected: ObserverSelection[] = [], frames: Array<{plan: StorybookPlan | null; notice: string}> = [];
  const observer: ObserverMap = {
    currentSnapshot: () => current, currentRoom: () => room, currentTile: () => ({x: 20, y: 20}), currentFollow: () => null,
    subscribe(fn) {feeds.add(fn); fn(current, true); return () => {feeds.delete(fn);};},
    subscribeRoom(fn) {rooms.add(fn); fn(room); return () => {rooms.delete(fn);};},
    subscribeFollow() {throw Error('unexpected follow ownership');}, select: value => selected.push(value),
    cover() {throw Error('unexpected original view cover');}, frame() {throw Error('unexpected original camera change');}, stopFollowing() {throw Error('unexpected follow change');}, setFollowResolver() {throw Error('unexpected resolver change');}, isFullMapTarget: () => false,
  };
  const surface: StorybookSurface = {present: (plan, notice) => frames.push({plan, notice}), subscribePick(fn) {picks.add(fn); return () => {picks.delete(fn);};}, dispose() {disposal++;}};
  return {world, r, snapshot, bundle, atlas, observer, surface, environment, flags, feeds, rooms, picks, changes, selected, frames, get disposal() {return disposal;},
    emit(value: Snapshot | null = snapshot, connected = true) {current = value; for (const fn of feeds) fn(value, connected);},
    room(value: string | null) {room = value; for (const fn of rooms) fn(value);},
    changed() {for (const fn of changes) fn();},
  };
}
