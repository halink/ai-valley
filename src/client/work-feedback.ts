import type {Vec,World,WorldEvent} from '../shared/types.js';
import {validWorkCompleted,type WorkCompleted} from '../shared/work-completion.js';
export interface WorkFeedbackReceipt {id:string;at:number;place:Vec;roomId:string|null;roomAt:Vec|null;workCompleted:WorkCompleted;}
const point=(p:Vec|null|undefined):p is Vec=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
/** Read-only observer presentation. Call reset on connection loss before the next full snapshot. */
export class WorkFeedback {
 private worldId:string|null=null;
 private minute=-Infinity;
 private revision=-Infinity;
 private seen=new Set<string>();
 reset():void {this.worldId=null;this.minute=-Infinity;this.revision=-Infinity;this.seen.clear();}
 inspect(world:Pick<World,'id'|'minute'|'revision'|'events'>):WorkFeedbackReceipt[] {
  if(!Number.isFinite(world.minute)||!Number.isFinite(world.revision))return [];
  if(this.worldId!==world.id){this.reset();this.worldId=world.id;this.minute=world.minute;this.revision=world.revision;for(const e of world.events)this.seen.add(e.id);return [];}
  if(world.minute<this.minute||world.revision<this.revision)return [];
  const fresh:WorkFeedbackReceipt[]=[];
  for(const e of world.events){
   if(this.seen.has(e.id))continue;
   this.seen.add(e.id);
   if(!this.valid(e,world.minute)||e.at<this.minute)continue;
   fresh.push({id:e.id,at:e.at,place:{...e.place},roomId:e.roomId??null,roomAt:e.roomAt?{...e.roomAt}:null,workCompleted:{...e.workCompleted!}});
  }
  this.minute=world.minute;this.revision=world.revision;return fresh;
 }
 private valid(e:WorldEvent,minute:number):boolean {
  const work=e.workCompleted;
  return !!work&&validWorkCompleted(work)&&typeof e.id==='string'&&!!e.id&&
   (e.kind==='action'||e.kind==='production')&&e.actors.includes(work.residentId)&&
   Number.isFinite(e.at)&&e.at<=minute&&work.startedAt<=e.at&&point(e.place)&&
   !e.regionalLocation&&(!e.roomId||point(e.roomAt));
 }
}
