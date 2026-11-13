import type {Resident,World} from '../shared/types.js';
import {residentBed,roomLayout,roomPath,sleepBuilding} from '../shared/rooms.js';
import {isDrinkingMvp} from './mvp-drinking.js';
/** Explicit small-world opt-in; formal worlds retain their existing semantics. */
export function hasMvpRooms(w:World){return isDrinkingMvp(w)&&w.mvpRooms?.version===1;}
export function validateMvpRooms(w:World){
 if(w.mvpRooms===undefined){
  // Legacy doorstep-inside saves contain no real interior position. Do not
  // invent one, cancel their plan, or rewrite them to make adoption convenient.
  if(w.rooms!==undefined||w.residents.some(r=>r.inside!==null||r.roomAt!=null||r.activity?.room||r.activity?.action.type==='sleep'||r.plan?.actions.some(a=>a.type==='sleep')))throw Error('godot_mvp_ambiguous_legacy_room_state');
  return;
 }
 const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 if(!hasMvpRooms(w)||!w.rooms||!Number.isFinite(w.rooms.tick)||!Array.isArray(w.rooms.claims)||!record(w.rooms.beds)||Object.values(w.rooms.beds).some(v=>!record(v)||Object.values(v).some(n=>!Number.isSafeInteger(n)||Number(n)<0))||!Number.isFinite(w.mvpRooms.adoptedAt)||w.mvpRooms.adoptedAt>w.minute)throw Error('godot_mvp_invalid_room_state');
 for(const r of w.residents){
  if(r.inside===null){if(r.roomAt!=null)throw Error('godot_mvp_invalid_room_position');continue;}
  const b=w.buildings.find(b=>b.id===r.inside),p=r.roomAt;
  if(!b||!p||!Number.isInteger(p.x)||!Number.isInteger(p.y)||r.at.x!==b.door.x||r.at.y!==b.door.y)throw Error('godot_mvp_invalid_room_position');
  const l=roomLayout(w,b);if(p.x<1||p.y<4||p.x>=l.width-1||p.y>=l.height-1)throw Error('godot_mvp_invalid_room_position');
 }
}
export function adoptMvpRooms(w:World){
 if(!isDrinkingMvp(w))return;
 validateMvpRooms(w);
 if(w.mvpRooms)return;
 w.rooms={tick:-1,claims:[],beds:{}};w.mvpRooms={version:1,adoptedAt:w.minute};
}
/** Check BEFORE exit planning, indoor travel and recovery. Failure preserves the
 * resident's actual position and leaves the next decision to its own driver. */
export function mvpSleepProblem(w:World,r:Resident):string|null{
 if(!hasMvpRooms(w)||r.activity?.action.type!=='sleep')return null;
 if(!w.rooms)return 'MVP真实房间状态缺失，不能执行睡眠';
 const a=r.activity.action,b=sleepBuilding(w,r,a);
 if(!b||a.buildingId)return 'MVP当前没有可使用的真实自有床位';
 const bed=residentBed(w,r,b),layout=roomLayout(w,b),target=layout.slots.find(s=>s.key==='bed:'+bed)?.at;
 if(bed===null||!target)return '真实床位已经失效，须留在当前位置重新决定';
 const pinned=r.activity.mvpBed;
 if(pinned&&(pinned.buildingId!==b.id||pinned.index!==bed))return '原床位已经改变，须留在当前位置重新决定';
 const from=r.inside===b.id?r.roomAt:layout.entry;
 if(r.inside&&r.inside!==b.id||!from)return '缺少可验证的实际室内位置，不能补造入口';
 const blocked=(p:{x:number;y:number})=>layout.blocked.some(q=>q.x===p.x&&q.y===p.y);
 if(blocked(from)||blocked(target)||roomPath(layout,from,target)===null)return '实际床位或室内路线已阻断，须留在当前位置重新决定';
 if(w.residents.some(p=>p.id!==r.id&&p.inside===b.id&&p.roomAt?.x===target.x&&p.roomAt.y===target.y))return '真实床位仍被其他居民实际占用，须重新决定';
 const journey=r.activity.room;
 if(journey?.mode==='work'&&(journey.buildingId!==b.id||journey.target.x!==target.x||journey.target.y!==target.y))return '原床位已经改变，须留在当前位置重新决定';
 r.activity.mvpBed??={buildingId:b.id,index:bed};
 return null;
}
