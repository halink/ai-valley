/** Page-local observation state. No renderer, transport, storage or world writes. */
import type {World} from '../shared/types.js';
import {ResidentFollow,type ResidentFollowResolver,type ResidentFollowState} from './resident-follow.js';

export class ObserverNavigation {
 private room:string|null=null;
 private follow=new ResidentFollow();
 private resolver:ResidentFollowResolver|null=null;
 private followNotice='';
 private roomListeners=new Set<(id:string|null)=>void>();
 private followListeners=new Set<(state:ResidentFollowState|null)=>void>();

 get roomId(){return this.room;}
 get followState(){return this.follow.state?{...this.follow.state}:null;}
 get followResolver(){return this.resolver;}
 setFollowResolver(resolver:ResidentFollowResolver|null){this.resolver=resolver;}
 startFollowing(world:World,id:string){return this.follow.start(world,id,this.resolver);}
 observeFollowing(world:World){return this.follow.observe(world,this.resolver);}
 clearFollowing(){this.follow.clear();}

 /** Commit only a room already prepared by the renderer, after validating its real ID. */
 recordRoom(world:World,id:string|null){
  if(id!==null&&!world.buildings.some(b=>b.id===id))throw new Error('observer_room_unavailable');
  this.room=id;
  for(const listener of this.roomListeners)listener(id);
 }
 /** Publish after ordinary follow routing (room -> follow -> snapshot).
  * New-world reset retains the existing clear-follow -> clear-room order instead. */
 publishFollow():boolean {
  const key=JSON.stringify(this.follow.state);
  if(key===this.followNotice)return false;
  this.followNotice=key;
  const state=this.followState;
  for(const listener of this.followListeners)listener(state?{...state}:null);
  return true;
 }
 subscribeRoom(listener:(id:string|null)=>void):()=>void {
  this.roomListeners.add(listener);
  try{listener(this.room);}catch(error){this.roomListeners.delete(listener);throw error;}
  return ()=>{this.roomListeners.delete(listener);};
 }
 subscribeFollow(listener:(state:ResidentFollowState|null)=>void):()=>void {
  this.followListeners.add(listener);
  try{listener(this.followState);}catch(error){this.followListeners.delete(listener);throw error;}
  return ()=>{this.followListeners.delete(listener);};
 }
}
