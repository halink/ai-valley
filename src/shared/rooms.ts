import {residentialStay} from './premises.js';
import {commonsStay,leasedBed} from './commons.js';
import type {Activity,Building,Resident,Vec,World} from './types.js';
export interface RoomSlot {key:string;at:Vec;kind:'bed'|'table'|'kitchen'|'station'|'care'|'pen'|'crop'|'bodyBay';}
export interface RoomLayout {width:number;height:number;entry:Vec;slots:RoomSlot[];blocked:Vec[];}
export interface RoomJourney {buildingId:string;mode:'work'|'exit';target:Vec;path:Vec[];progress:number;}
export interface RoomState {tick:number;claims:Array<{buildingId:string;key:string;group:string;people:string[]}>;beds:Record<string,Record<string,number>>;}
export function roomLayout(w:World,b:Building):RoomLayout {
 const beds=['home','lodge','clinic'].includes(b.kind)?b.capacity:0;
 const animals=b.kind==='barn'?Math.max(4,Math.floor(b.width*b.height/8)):0;
 const cols=Math.max(16,b.width*2),rows=Math.max(['workshop','store','greenhouse'].includes(b.kind)?16:13,Math.ceil(beds/2)*3+7,Math.ceil(animals/2)*4+5,b.height*2+3);
 const center=Math.floor(cols/2),slots:RoomSlot[]=[{key:'table',at:{x:center,y:8},kind:'table'},{key:'kitchen',at:{x:center,y:4},kind:'kitchen'}];
 for(let i=0;i<beds;i++)slots.push({key:'bed:'+i,at:{x:i%2?cols-3:2,y:5+Math.floor(i/2)*3},kind:'bed'});
 const positions={bench:{x:center,y:8},forge:{x:cols-4,y:5},mill:{x:3,y:9},dairy:{x:cols-4,y:9},loom:{x:cols-4,y:rows-4},preserver:{x:3,y:rows-4}};
 for(const station of w.industry?.stations.filter(s=>s.buildingId===b.id)??[])slots.push({key:'station:'+station.kind,at:positions[station.kind],kind:'station'});
 if(['clinic','lodge'].includes(b.kind))for(let i=0;i<2;i++)slots.push({key:'bodyBay:'+i,kind:'bodyBay',at:{x:i?cols-3:2,y:rows-3}});
 slots.push({key:'care',at:{x:4,y:5},kind:'care'});
 for(let i=0;i<animals;i++)slots.push({key:'pen:'+i,kind:'pen',at:{x:i%2?cols-5:4,y:7+Math.floor(i/2)*4}});
 if(b.kind==='greenhouse')for(let i=0;i<4;i++)slots.push({key:'crop:'+i,kind:'crop',at:{x:i%2?10:4,y:i<2?8:12}});
 const blocked:Vec[]=[];if(!['barn','greenhouse'].includes(b.kind))for(let x=center-2;x<=center+1;x++)for(let y=6;y<=7;y++)blocked.push({x,y});
 for(const s of slots.filter(s=>s.kind==='bed'))for(let x=s.at.x-1;x<=s.at.x;x++)for(let y=s.at.y-2;y<s.at.y;y++)blocked.push({x,y});
 for(const p of w.residents)if(p.status==='dead'&&p.body?.storedAt===b.id&&p.roomAt&&!p.body.carriedBy)blocked.push({...p.roomAt});
 return {width:cols,height:rows,entry:{x:center,y:rows-2},slots,blocked};
}
export function roomPath(layout:RoomLayout,from:Vec,to:Vec):Vec[]|null {
 const index=(p:Vec)=>p.y*layout.width+p.x,inBounds=(p:Vec)=>p.x>=1&&p.y>=4&&p.x<layout.width-1&&p.y<layout.height-1;
 if(!inBounds(from)||!inBounds(to))return null;const blocked=new Set(layout.blocked.map(index)),seen=new Map<number,Vec>(),queue=[{...from}];seen.set(index(from),from);
 for(let i=0;i<queue.length;i++){const p=queue[i];if(p.x===to.x&&p.y===to.y){const route:Vec[]=[];let at=p;while(at.x!==from.x||at.y!==from.y){route.push(at);at=seen.get(index(at))!;}return route.reverse();}
  for(const [x,y]of [[1,0],[-1,0],[0,1],[0,-1]]){const q={x:p.x+x,y:p.y+y};if(!inBounds(q)||seen.has(index(q))||blocked.has(index(q)))continue;seen.set(index(q),p);queue.push(q);}
 }return null;
}
export function actionRoom(w:World,r:Resident,a:Activity):{building:Building;key:string;group:string;target:Vec}|null {
 const action=a.action;let id:string|undefined,key='table',group=r.id,target:Vec|undefined;
 // Unilateral decisions stay where the actor is; they do not approach a partner or chase oneself.
 if(action.type==='separate'||action.type==='respond'&&!action.accept&&w.proposals.find(p=>p.id===action.proposalId)?.actorId===r.id||action.type==='respond'&&!action.accept&&w.proposals.some(p=>p.id===action.proposalId&&p.kind==='care'&&p.targetId===r.id))return null;
 if(action.type==='personalFoodGift'){
  if(action.operation!=='deliver')return null;const c=w.personalFoodGifts?.gifts.find(c=>c.id===action.giftId);if(!c?.location.inside||!c.location.roomAt)return null;id=c.location.inside;target={...c.location.roomAt};key='personal-food-gift:'+c.id;
 }else if(action.type==='pregnancyPreparation'&&action.operation==='attend'){
  const c=w.pregnancyPreparation?.arrangements.find(c=>c.id===action.arrangementId);if(!c)return null;id=c.buildingId;key='pregnancy-care:'+c.id;const b=w.buildings.find(b=>b.id===id);if(!b)return null;const bed=roomLayout(w,b).slots.find(s=>s.key==='bed:'+c.bed);if(!bed)return null;target={x:bed.at.x+1,y:bed.at.y};
 }else if(action.type==='familyRelocation'&&(action.operation==='escort'||action.operation==='returnChild')&&action.phase!=='delivery'){
  const p=w.residents.find(p=>p.id===action.personId);if(!p?.inside)return null;const b=w.buildings.find(b=>b.id===p.inside);if(!b)return null;id=b.id;target=p.roomAt??roomLayout(w,b).entry;key='person:'+p.id;
 }else if(action.type==='familyRelocation'&&action.operation==='returnChild'&&action.phase==='delivery'){
  const p=w.residents.find(p=>p.id===action.personId),b=w.buildings.find(b=>b.id===p?.homeId);if(!p||!b)return null;const bed=residentBed(w,p,b);if(bed===null)return null;id=b.id;key='bed:'+bed;group=p.id;
 }else if(action.type==='industry'&&action.operation==='collectTool'){const t=w.industry?.tools.find(t=>t.id===action.toolId);if(!t?.location?.inside)return null;id=t.location.inside;const b=w.buildings.find(b=>b.id===id);if(!b)return null;const layout=roomLayout(w,b),at=t.location.roomAt??layout.entry;key='tool:'+t.id;target=[at,{x:at.x-1,y:at.y},{x:at.x+1,y:at.y},{x:at.x,y:at.y+1}].find(to=>roomPath(layout,r.inside===id?r.roomAt??layout.entry:layout.entry,to)!==null);if(!target)return null;
 }else if(action.type==='production'&&action.operation==='custodyInspect'){
  const c=w.production?.protectedCustody?.mandates.find(c=>c.id===action.custodyId),loc=c?.locations[action.custodyAssetId??''];if(!loc?.inside)return null;id=loc.inside;target=loc.roomAt??undefined;key='custody-inspect:'+action.custodyAssetId;
 }else if(action.type==='production'&&['custodyFeedAnimal','custodyWaterAnimal','custodyCollectAnimal'].includes(action.operation)){
  const n=w.industry?.animals.find(n=>n.id===action.animalId);if(!n)return null;const inside=n.at?n.inside:n.barnId;if(!inside)return null;id=inside;const b=w.buildings.find(b=>b.id===id);if(!b)return null;const layout=roomLayout(w,b);key='pen:'+(n.pen??0);target=n.roomAt??layout.slots.find(s=>s.key===key)?.at??layout.entry;
 }else if(action.type==='production'&&['collectEstate','emergencyEstateRation','custodySell','custodyBuy'].includes(action.operation)){const p=w.estates.flatMap(e=>e.parcels??[]).find(p=>p.id===action.parcelId)??(action.operation==='emergencyEstateRation'?w.estates.filter(e=>'estate:'+e.personId===action.parcelId).map(e=>({id:action.parcelId,location:e.location}))[0]:undefined);if(!p?.location?.inside)return null;id=p.location.inside;const b=w.buildings.find(b=>b.id===id);if(!b)return null;const layout=roomLayout(w,b),at=p.location.roomAt??layout.entry;key='estate:'+p.id;target=[at,{x:at.x-1,y:at.y},{x:at.x+1,y:at.y},{x:at.x,y:at.y+1}].find(to=>roomPath(layout,r.inside===id?r.roomAt??layout.entry:layout.entry,to)!==null);if(!target)return null;
 }else if(action.type==='culture'&&['prepare','attend','open','speak','take','supply','cleanup','reclaim','protectEstate'].includes(action.operation)){const e=w.culture?.events.find(e=>e.id===action.eventId);if(!e)return null;id=e.buildingId;group=e.id;const b=w.buildings.find(b=>b.id===id);if(!b)return null;const seats=assemblySeats(roomLayout(w,b)),index=Math.max(0,e.participants.filter(p=>p.withdrawnAt===null).findIndex(p=>p.personId===r.id));target=['prepare','cleanup','reclaim','protectEstate'].includes(action.operation)?seats[0]:seats[index];
 }else if(action.type==='social'&&action.operation==='start'){id=r.inside??undefined;group='meeting-start:'+a.planId;
 }else if(action.type==='social'&&['join','speak'].includes(action.operation)){const m=w.social?.meetings.find(m=>m.id===action.meetingId);if(!m?.roomId)return null;id=m.roomId;group=m.id;const taken=new Set(m.members.filter(p=>p.leftAt===null&&p.personId!==r.id).map(p=>p.seat)),seat=m.members.find(p=>p.personId===r.id&&p.leftAt===null)?.seat??[0,1,2,3,4,5,6,7].find(i=>!taken.has(i));if(seat===undefined)return null;const b=w.buildings.find(b=>b.id===id);if(!b)return null;const at=m.roomAt??roomLayout(w,b).entry,[x,y]=[[0,0],[-2,0],[2,0],[0,2],[-2,2],[2,2],[-3,1],[3,1]][seat];target={x:at.x+x,y:at.y+y};
 }else if(action.type==='funerary'&&action.operation==='store'&&a.cargo?.pickedUp){id=a.cargo.storageId;key='bodyBay:'+a.cargo.storageSlot;group=a.cargo.bodyId;const b=w.buildings.find(b=>b.id===id),slot=b&&roomLayout(w,b).slots.find(s=>s.key===key);if(slot)target={x:slot.at.x+1,y:slot.at.y};
 }else if((action.type==='bury'||action.type==='funerary'&&['store','verify'].includes(action.operation))&&!a.cargo?.pickedUp){const p=w.residents.find(p=>p.id===action.targetId);if(!p?.inside)return null;id=p.inside;const b=w.buildings.find(b=>b.id===id);if(!b)return null;const layout=roomLayout(w,b),at=p.roomAt??layout.entry;target=[{x:at.x-1,y:at.y},{x:at.x+1,y:at.y},{x:at.x,y:at.y+1}].find(to=>roomPath(layout,r.inside===id?r.roomAt??layout.entry:layout.entry,to)!==null);if(!target)return null;key='body:'+p.id;
 }else if(action.type==='emergencyCare'&&['inspect','visitHelp'].includes(action.operation)){
  const p=action.observedTarget;if(!p?.inside)return null;id=p.inside;const b=w.buildings.find(b=>b.id===id);if(!b||b.condition<=0||!(b.ownerId==='commons'||b.ownerId===r.id||b.residents.includes(r.id)||commonsStay(w,r,b.id)))return null;target=p.roomAt??roomLayout(w,b).entry;key='child-care-inspect:'+p.id;
 }else if(action.type==='longCare'&&action.operation==='visit'){
  const c=w.longCare?.agreements.find(c=>c.id===action.agreementId),p=c&&w.residents.find(p=>p.id===c.beneficiaryId);if(!p?.inside)return null;const b=w.buildings.find(b=>b.id===p.inside);if(!b||r.at.x!==b.door.x||r.at.y!==b.door.y)return null;id=b.id;const layout=roomLayout(w,b),at=p.roomAt??layout.entry;target=[{x:at.x-1,y:at.y},{x:at.x+1,y:at.y},{x:at.x,y:at.y+1}].find(to=>roomPath(layout,r.inside===id?r.roomAt??layout.entry:layout.entry,to)!==null);if(!target)return null;key='person:'+p.id;
 }else if(action.type==='health'&&['rescue','stabilize'].includes(action.operation)){
  const p=w.residents.find(p=>p.id===action.targetId);if(!p)return null;
  if(action.operation==='rescue'&&action.phase==='delivery'){const t=w.health?.transports.find(t=>t.id===action.transportId),b=w.buildings.find(b=>b.id===action.buildingId);if(!t||!b||t.bed===null)return null;id=b.id;key='bed:'+t.bed;group=t.id;const bed=roomLayout(w,b).slots.find(s=>s.key==='bed:'+t.bed);if(bed)target={x:bed.at.x+1,y:bed.at.y};}
  else {if(!p.inside)return null;id=p.inside;const b=w.buildings.find(b=>b.id===id);if(!b)return null;const layout=roomLayout(w,b),at=p.roomAt??layout.entry;target=[{x:at.x-1,y:at.y},{x:at.x+1,y:at.y},{x:at.x,y:at.y+1}].find(to=>roomPath(layout,r.inside===id?r.roomAt??layout.entry:layout.entry,to)!==null);if(!target)return null;key='person:'+p.id;}
 }else if(['talk','care','learn','offer','accept','propose','respond','separate','tendChild','fosterChild','familyConsent','inviteHome'].includes(action.type)){
  const actionTarget='targetId' in action?action.targetId:action.type==='accept'?w.offers.find(o=>o.id===action.offerId)?.actorId:action.type==='respond'?w.proposals.find(p=>p.id===action.proposalId)?.actorId:undefined;
  const p=action.observedTarget?.id===actionTarget?action.observedTarget:w.residents.find(p=>p.id===actionTarget);if(!p?.inside)return null;id=p.inside;const b=w.buildings.find(b=>b.id===id);if(!b)return null;const layout=roomLayout(w,b),at=p.roomAt??layout.entry;
  const candidates=[{x:at.x-1,y:at.y},{x:at.x+1,y:at.y},{x:at.x,y:at.y+1},{x:at.x,y:at.y-1}].map(to=>({to,path:roomPath(layout,r.inside===id?r.roomAt??layout.entry:layout.entry,to)})).filter(c=>c.path!==null).sort((a,b)=>a.path!.length-b.path!.length);
  target=candidates[0]?.to;if(!target)return null;key='person:'+p.id;
 }else if(action.type==='civic'&&(action.operation==='supplyReserve'||action.operation==='openReserve'||action.operation==='deliverReserve')){id=w.civic?.reserves?.find(p=>p.id===action.reserveId)?.buildingId;
 }else if(action.type==='premises'&&action.operation==='collect'){
  const c=w.industry?.batches.find(c=>c.id===action.batchId);if(!c)return null;id=c.buildingId;key=c.recipe.station?'station:'+c.recipe.station:'table';
 }else if(action.type==='waterSupply'&&'buildingId'in action){id=action.buildingId;key=action.operation==='boil'?'kitchen':'table';
 }else if(action.type==='commons'){id=action.buildingId;
 }else if(action.type==='sleep'){const b=sleepBuilding(w,r,action);if(!b)return null;id=b.id;const bed=action.buildingId?commonsStay(w,r,b.id)?.bed??(residentialStay(w,r.id,b.id)?0:null):residentBed(w,r,b);if(bed===null)return null;key='bed:'+bed;}
 else if(action.type==='cook'){id=cookingBuilding(w,r,a)?.id;key='kitchen';}
 else if(action.type==='education'&&['teach','study'].includes(action.operation)){
  const l=w.education?.lessons.find(l=>l.id===action.lessonId);if(!l)return null;id=l.buildingId;group=l.id;const b=w.buildings.find(b=>b.id===id);if(!b)return null;const center=Math.floor(roomLayout(w,b).width/2);
  const e=l.enrollments.find(e=>e.learnerId===r.id);target=action.operation==='teach'?{x:center,y:5}:[{x:center-2,y:8},{x:center,y:8},{x:center+2,y:8},{x:center,y:10}][e?.seat??0];
 }else if(action.type==='employment'&&action.operation==='work'){
  const c=w.employment?.contracts.find(c=>c.id===action.contractId);if(!c)return null;id=c.buildingId;key=c.recipe?.station?'station:'+c.recipe.station:c.terms.role==='cook'?'kitchen':'table';
 }else if(action.type==='design'&&action.operation!=='equip'&&action.operation!=='trial'){id=action.buildingId;
 }else if(action.type==='industry'&&['craft','install','uninstall','upgrade','repairTool','plantHouse','tendHouse','harvestHouse','placeAnimal','feedAnimal','waterAnimal','collectAnimal','breedAnimal','moveAnimal'].includes(action.operation)){
  const n=w.industry?.animals.find(n=>n.id===action.animalId);id=action.buildingId??n?.barnId;
  if(action.operation==='craft'){const batch=w.industry?.batches.find(b=>b.ownerId===r.id&&b.status==='working');const station=batch?.recipe.station??action.station;key=station?'station:'+station:'table';}
  if(action.operation==='install'||action.operation==='uninstall'||action.operation==='upgrade'||action.operation==='repairTool')key=action.station?'station:'+action.station:'table';
  if(['plantHouse','tendHouse','harvestHouse'].includes(action.operation))key='crop:'+action.bed;
  if(action.operation==='moveAnimal'&&n){
   if(action.phase==='delivery'&&action.pastureId)return null;
   id=action.phase==='delivery'?action.buildingId:n.at?n.inside??undefined:n.barnId;
   key='pen:'+(action.phase==='delivery'&&action.buildingId!==n.barnId?freePen(w,action.buildingId!):n.pen??0);
   if(action.phase!=='delivery'&&n.roomAt)target={...n.roomAt};
  }
  if(n&&['feedAnimal','waterAnimal','collectAnimal','breedAnimal'].includes(action.operation)){key='pen:'+(n.pen??0);if(n.at){id=n.inside??undefined;if(n.roomAt)target={...n.roomAt};}}
 }else if(action.type==='health'&&['treat','receive'].includes(action.operation)){
  const c=w.health?.appointments.find(c=>c.id===action.appointmentId);if(!c)return null;id=c.buildingId;group=c.id;key='bed:0';const b=w.buildings.find(b=>b.id===id);if(b){const layout=roomLayout(w,b);target=layout.slots.find(s=>s.key===(action.operation==='receive'?'bed:0':'care'))?.at;}
 }else if(action.type==='publicDuty'&&action.operation==='inspect'){
  id=action.buildingId;key='public-service-inspect';group='public-service-inspect:'+id;const b=w.buildings.find(b=>b.id===id);if(!b)return null;const point=roomLayout(w,b).slots.find(s=>s.key===(b.kind==='clinic'?'bed:0':'table'))?.at;if(!point)return null;target=b.kind==='clinic'?{x:point.x+1,y:point.y}:{x:point.x,y:point.y+1};
 }else if(action.type==='publicDuty'&&['attend','stay','receive'].includes(action.operation)){
  const shift=w.duties?.shifts.find(s=>s.id===action.shiftId);if(!shift)return null;if(action.operation==='attend'&&w.minute<shift.start)return null;id=shift.buildingId;group=shift.id;key=shift.role==='kitchen'?'kitchen':'bed:0';
  if(shift.role==='care'&&action.operation!=='receive'){const b=w.buildings.find(b=>b.id===id);if(b)target=roomLayout(w,b).slots.find(s=>s.key==='care')?.at;}
  if(action.operation==='receive'){const b=w.buildings.find(b=>b.id===id);if(b){const layout=roomLayout(w,b);target=shift.role==='care'?layout.slots.find(s=>s.key==='bed:0')?.at:layout.slots.find(s=>s.key==='table')?.at;}}
 }else return null;
 const b=w.buildings.find(b=>b.id===id);if(!b)return null;const layout=roomLayout(w,b);const slot=layout.slots.find(s=>s.key===key);
 if(key==='station:bench')key='table';
 return {building:b,key,group,target:target??slot?.at??layout.slots.find(s=>s.key==='table')!.at};
}

function freePen(w:World,id:string){const taken=new Set((w.industry?.animals??[]).filter(n=>n.barnId===id&&n.status==='alive').map(n=>n.pen??0));let i=0;while(taken.has(i))i++;return i;}

export function residentBed(w:World,r:Resident,b:Building):number|null{
 const assignments=w.rooms?.beds[b.id]??{},beds=new Map<string,number>(),taken=new Set<number>();
 for(const id of b.residents){const n=assignments[id];if(Number.isInteger(n)&&n>=0&&n<b.capacity&&!taken.has(n)&&!leasedBed(w,b.id,n,id)){beds.set(id,n);taken.add(n);}}
 for(const id of b.residents){if(beds.has(id))continue;let n=0;while(taken.has(n)||leasedBed(w,b.id,n,id))n++;if(n<b.capacity){beds.set(id,n);taken.add(n);}}
 const own=beds.get(r.id);if(own!==undefined)return own;
 if(b.residents.includes(r.id))return null;
 let bed=0;while(taken.has(bed)||leasedBed(w,b.id,bed,r.id))bed++;return bed<b.capacity?bed:null;
}

export function sleepBuilding(w:World,r:Resident,a:{buildingId?:string}){return a.buildingId?(commonsStay(w,r,a.buildingId)||residentialStay(w,r.id,a.buildingId))&&w.buildings.find(b=>b.id===a.buildingId):w.buildings.find(b=>b.id===r.homeId&&b.condition>0&&b.residents.includes(r.id));}

/** A saved cooking trip keeps its selected kitchen, never a newly preferred home or lodge. */
export function cookingBuilding(w:World,r:Resident,a:Activity):Building|undefined {
 if(a.action.type!=='cook')return undefined;
 const id=a.action.buildingId??(a.room?.mode==='work'?a.room.buildingId:undefined);
 if(id!==undefined)return w.buildings.find(b=>b.id===id);
 // Old underway actions stored a target doorway (and sometimes an indoor location).
 return w.buildings.find(b=>b.id===r.inside&&b.door.x===a.target.x&&b.door.y===a.target.y)
  ??w.buildings.find(b=>b.door.x===a.target.x&&b.door.y===a.target.y);
}

/** An actual cooking claim is local to one kitchen, including its indoor approach. */
export function occupiesKitchen(w:World,r:Resident,buildingId:string):boolean {
 const a=r.activity;
 if(r.status!=='alive'||r.residency==='outside'||a?.action.type!=='cook'||a.path.length||a.room?.mode==='exit'||r.inside!==null&&r.inside!==buildingId)return false;
 const b=cookingBuilding(w,r,a);
 return b?.id===buildingId&&r.at.x===b.door.x&&r.at.y===b.door.y;
}

/** Reachable standing places around the common table, excluding bed and service positions. */
export function assemblySeats(layout:RoomLayout){
 const center=layout.slots.find(s=>s.key==='table')!.at,key=(p:{x:number;y:number})=>p.y*layout.width+p.x,blocked=new Set(layout.blocked.map(key)),furniture=new Set(layout.slots.filter(s=>s.kind!=='table').map(s=>key(s.at))),seen=new Set<number>([key(layout.entry)]),queue=[{...layout.entry}];
 for(let i=0;i<queue.length;i++)for(const [x,y] of [[1,0],[-1,0],[0,1],[0,-1]]){const at={x:queue[i].x+x,y:queue[i].y+y},index=key(at);if(at.x<1||at.y<4||at.x>=layout.width-1||at.y>=layout.height-1||seen.has(index)||blocked.has(index))continue;seen.add(index);queue.push(at);}
 return queue.filter(p=>!furniture.has(key(p))).sort((a,b)=>(Math.abs(a.x-center.x)+Math.abs(a.y-center.y))-(Math.abs(b.x-center.x)+Math.abs(b.y-center.y))||a.y-b.y||a.x-b.x);

}
