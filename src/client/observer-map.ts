/** Read-only presentation adapter. The ordinary client remains the sole transport owner. */
import type {Snapshot,Vec} from '../shared/types.js';
import type {ResidentFollowState,ResidentFollowResolver} from './resident-follow.js';
import type {SceneSelection} from './scene.js';
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
 select(value:SceneSelection):void;
 isFullMapTarget(target:EventTarget|null):boolean;
 cover(covered:boolean):void;
}
