/** Read-only presentation adapter. The ordinary client remains the sole transport owner. */
import type {Snapshot,Vec} from '../shared/types.js';
import type {ResidentFollowState,ResidentFollowResolver} from './resident-follow.js';
import type {EcologySelection} from './animal-observation.js';
import type {ObserverNavigation} from './observer-navigation.js';
export type ObserverSelection={kind:'person'|'building'|'project';id:string}|EcologySelection|null;
export interface ObserverMap {
 currentSnapshot():Snapshot|null;
 currentRoom():string|null;
 currentTile():Vec;
 currentFollow():ResidentFollowState|null;
 subscribe(listener:(snapshot:Snapshot|null,connected:boolean)=>void):()=>void;
 subscribeRoom(listener:(id:string|null)=>void):()=>void;
 subscribeFollow(listener:(state:ResidentFollowState|null)=>void):()=>void;
 stopFollowing():void;
 setFollowResolver(resolver:ResidentFollowResolver|null):void;
 frame(at:Vec):void;
 select(value:ObserverSelection):void;
 isFullMapTarget(target:EventTarget|null):boolean;
 cover(covered:boolean):void;
}

/** Physical camera/presentation operations belong to a renderer, never to world state.
 * currentTile/frame use valley cells (a room returns its building door), not pixels
 * or room-local coordinates. Clearing a resolver must revalidate ordinary following.
 * This fixed binding deliberately does not promise live renderer replacement.
 */
export interface ObserverRendererPort {
 currentTile():Vec;
 stopFollowing():void;
 setFollowResolver(resolver:ResidentFollowResolver|null):void;
 frame(at:Vec):void;
 cover(covered:boolean):void;
}
export interface ObserverSource {
 currentSnapshot():Snapshot|null;
 subscribe(listener:(snapshot:Snapshot|null,connected:boolean)=>void):()=>void;
}
export function createObserverMap(source:ObserverSource,navigation:ObserverNavigation,renderer:ObserverRendererPort,ui:{select(value:ObserverSelection):void;isFullMapTarget(target:EventTarget|null):boolean}):ObserverMap {
 return {
  currentSnapshot:()=>source.currentSnapshot(),
  currentRoom:()=>navigation.roomId,
  currentTile:()=>({...renderer.currentTile()}),
  currentFollow:()=>navigation.followState,
  subscribe:listener=>source.subscribe(listener),
  subscribeRoom:listener=>navigation.subscribeRoom(listener),
  subscribeFollow:listener=>navigation.subscribeFollow(listener),
  stopFollowing:()=>renderer.stopFollowing(),
  setFollowResolver:resolver=>renderer.setFollowResolver(resolver),
  frame:at=>renderer.frame({...at}),
  select:value=>{renderer.stopFollowing();ui.select(value?{...value}:null);},
  isFullMapTarget:target=>ui.isFullMapTarget(target),
  cover:covered=>renderer.cover(covered),
 };
}
