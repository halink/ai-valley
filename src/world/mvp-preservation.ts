import type {World,Resident,Activity,Action,Inventory} from '../shared/types.js';
import {PRESERVATION_COST,PRESERVATION_WORK,PRESERVATION_LIFE,type PreservationAction} from '../shared/mvp-preservation.js';
import {MVP_HALL,hasMvpHamlet} from '../shared/mvp-hamlet.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import {emitEvent,emitLedgerEvent} from './events.js';
const MARK='action/mvp-preservation@1';
const own=(v:object,k:string)=>Object.prototype.hasOwnProperty.call(v,k);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[])=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>own(v,k));
const nonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const integer=(v:unknown):v is number=>nonnegative(v)&&Number.isSafeInteger(v);
function fail():never {throw Error('mvp_preservation_invalid_state');}
/** Death seals the same physical lots in the existing estate, never consumes
 * them or refreshes their expiry. Further estate parcel redistribution is not
 * enabled in this small-world slice. */
function preservationInventory(w:World,r:Resident):Inventory {
 if(r.status!=='dead')return r.inventory;
 const estates=w.estates.filter(e=>e.personId===r.id),estate=estates[0];
 if(estates.length!==1||!estate||estate.status!=='protected'||(r.inventory.preserve??0)!==0||estate.parcels?.some(p=>(p.inventory.preserve??0)>0))throw Error('mvp_preservation_unsupported_estate_container');
 return estate.inventory;
}
export function validPreservationAction(a:unknown):a is PreservationAction {return record(a)&&a.type==='mvpPreservation'&&typeof a.operation==='string'&&['install','preserve'].includes(a.operation)&&Object.keys(a).every(k=>['type','operation','observedTarget'].includes(k));}
export function validateMvpPreservation(w:World):void {
 if(!own(w,'mvpPreservation')){if(w.definitions&&own(w.definitions,MARK)||w.residents?.some(r=>r.activity?.action.type==='mvpPreservation'||r.plan?.actions.some(a=>a.type==='mvpPreservation')))fail();return;}
 const s=w.mvpPreservation;
 if(!s||!exact(s,['schemaVersion','adoptedAt','lastMinute','nextSequence','installed','accounts','attempts','receipts'])||s.schemaVersion!==1||w.mode!=='validation'||!hasMvpHamlet(w)||w.mvpRooms?.version!==1||!w.mvpAgriculture||w.food!==undefined||!nonnegative(s.adoptedAt)||s.adoptedAt>w.minute||s.lastMinute!==w.minute||!integer(s.nextSequence)||s.nextSequence<1||!record(s.accounts)||!record(s.attempts)||!record(s.receipts)||!w.definitions?.[MARK]||w.definitions[MARK].id!=='action/mvp-preservation'||w.definitions[MARK].version!==1||w.definitions[MARK].kind!=='action'||w.definitions[MARK].data.preservationVersion!==1)fail();
 const used=new Set<string>();const id=(value:string)=>{if(typeof value!=='string'||!/^preservation:[1-9][0-9]*$/.test(value)||!integer(Number(value.split(':')[1]))||Number(value.split(':')[1])>=s.nextSequence||used.has(value))fail();used.add(value);};
 for(const [key,a]of Object.entries(s.attempts)){id(key);if(!exact(a,['actorId','operation','at'])||!w.residents.some(r=>r.id===a.actorId)||!['install','preserve'].includes(a.operation)||!nonnegative(a.at)||a.at<s.adoptedAt||a.at>w.minute)fail();}
 for(const [key,r]of Object.entries(s.receipts)){const attempt=s.attempts[key];if(!attempt||attempt.actorId!==r.actorId||attempt.operation!==r.operation||r.at<attempt.at||r.workMinutes!==PRESERVATION_WORK[r.operation]||r.at-attempt.at+1+1e-7<r.workMinutes)fail();if(!exact(r,['actorId','operation','at','workMinutes','eventId'])||!w.residents.some(p=>p.id===r.actorId)||!['install','preserve'].includes(r.operation)||!nonnegative(r.at)||r.at<s.adoptedAt||r.at>w.minute||typeof r.eventId!=='string'||!r.eventId)fail();}
 const installations=Object.entries(s.receipts).filter(([,r])=>r.operation==='install');
 if(s.installed===null){if(installations.length)fail();}else{const i=s.installed,r=s.receipts[i.executionId];if(!exact(i,['executionId','actorId','at','eventId'])||installations.length!==1||!r||r.operation!=='install'||r.actorId!==i.actorId||r.at!==i.at||r.eventId!==i.eventId)fail();}
 if(Object.keys(s.accounts).length!==w.residents.length)fail();
 const lotIds=new Set<string>();for(const r of w.residents){const a=s.accounts[r.id];if(!exact(a,['unknown','lots'])||!integer(a.unknown)||!Array.isArray(a.lots))fail();let held=a.unknown;
  for(const l of a.lots){const receipt=s.receipts[l.id];if(!exact(l,['id','producedAt','expiresAt','quantity','removed','spoiled'])||lotIds.has(l.id)||!receipt||receipt.operation!=='preserve'||receipt.actorId!==r.id||receipt.at!==l.producedAt||!nonnegative(l.producedAt)||l.expiresAt!==l.producedAt+PRESERVATION_LIFE||!integer(l.quantity)||!integer(l.removed)||!integer(l.spoiled)||l.quantity+l.removed+l.spoiled!==2||l.quantity>0&&l.expiresAt<=w.minute)fail();lotIds.add(l.id);held+=l.quantity;}
  const stock=preservationInventory(w,r);if(!integer(stock.preserve??0)||held!==(stock.preserve??0))fail();
  for(const action of r.plan?.actions??[])if(action.type==='mvpPreservation'&&!validPreservationAction(action))fail();
  if(r.activity?.action.type==='mvpPreservation'){if(!validPreservationAction(r.activity.action)||!r.activity.mvpPreservationExecutionId)fail();const a=s.attempts[r.activity.mvpPreservationExecutionId];if(!a||own(s.receipts,r.activity.mvpPreservationExecutionId)||a.actorId!==r.id||a.operation!==r.activity.action.operation||a.at!==r.activity.startedAt||!nonnegative(r.activity.mvpPreservationWorked)||!nonnegative(r.activity.remaining)||r.activity.mvpPreservationWorked>w.minute-r.activity.startedAt+1+1e-7||Math.abs(r.activity.mvpPreservationWorked+r.activity.remaining-PRESERVATION_WORK[r.activity.action.operation])>1e-7)fail();}
 }
 for(const [key,r]of Object.entries(s.receipts))if(r.operation==='preserve'&&!lotIds.has(key))fail();
}
export function adoptMvpPreservation(w:World):boolean {
 if(own(w,'simulationOnly'))throw Error('mvp_preservation_simulation_adoption');
 if(own(w,'mvpPreservation')){validateMvpPreservation(w);return false;}
 validateMvpPreservation(w);
 if(w.mode!=='validation'||!w.mvpAgriculture||!hasMvpHamlet(w)||w.food!==undefined)throw Error('mvp_preservation_scope');
 const accounts=Object.fromEntries(w.residents.map(r=>{const unknown=preservationInventory(w,r).preserve??0;if(!integer(unknown))fail();return [r.id,{unknown,lots:[]}];}));
 w.mvpPreservation={schemaVersion:1,adoptedAt:w.minute,lastMinute:w.minute,nextSequence:1,installed:null,accounts,attempts:{},receipts:{}};
 w.definitions[MARK]={id:'action/mvp-preservation',version:1,kind:'action',dependencies:[],data:{preservationVersion:1}};
 validateMvpPreservation(w);return true;
}
export function allocatePreservationExecution(w:World,r:Resident,a:Activity):void {if(a.action.type!=='mvpPreservation')return;const s=w.mvpPreservation;if(!s||a.mvpPreservationExecutionId||!Number.isSafeInteger(s.nextSequence+1))fail();a.mvpPreservationWorked=0;a.mvpPreservationExecutionId='preservation:'+s.nextSequence++;s.attempts[a.mvpPreservationExecutionId]={actorId:r.id,operation:a.action.operation,at:w.minute};}
export function preservationStation(w:World,r:Resident){const b=w.buildings.find(b=>b.id===MVP_HALL);if(!b||b.condition<=0||!r.knownBuildings.includes(b.id))return null;const layout=roomLayout(w,b),slot=layout.slots.find(s=>s.key==='kitchen');const from=r.inside===b.id?r.roomAt:layout.entry;return slot&&from&&roomPath(layout,from,slot.at)!==null?{building:b,at:slot.at}:null;}
export function preservationReason(w:World,r:Resident,a:PreservationAction,onSite=false):string|null {
 if(!validPreservationAction(a)||!w.mvpPreservation||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress)return '当前无法进行受限罐藏劳动';
 const station=preservationStation(w,r);if(!station)return '没有已知且实际可达的灶堂工位';
 if(onSite&&(r.inside!==station.building.id||r.at.x!==station.building.door.x||r.at.y!==station.building.door.y||r.roomAt?.x!==station.at.x||r.roomAt?.y!==station.at.y))return '尚未实际到达罐藏劳动工位';
 if(a.operation==='install'&&w.mvpPreservation.installed)return '共用罐藏工位已经安装';
 if(a.operation==='preserve'&&!w.mvpPreservation.installed)return '罐藏工位尚未真实安装';
 for(const [item,n]of Object.entries(PRESERVATION_COST[a.operation])){const held=r.inventory[item as keyof Resident['inventory']]??0;if(!Number.isFinite(held)||held<n)return '罐藏劳动缺少本人真实材料';}
 return null;
}
export function preservationRoute(w:World,r:Resident,a:PreservationAction){const error=preservationReason(w,r,a);return error?{error,target:{...r.at},duration:0}:{target:preservationStation(w,r)!.building.door,duration:PRESERVATION_WORK[a.operation]};}
/** Unsupported batch transfers must not wash an expiring lot into immortal
 * unknown stock. Check direct goods and current accepted offer terms at every
 * execution boundary. Formal worlds have no such limited-MVP gate. */
export function preservationTransferReason(w:World,a:Action):string|null {
 if(!w.mvpPreservation||a.type==='eat'||a.type==='mvpPreservation')return null;
 const contains=(value:unknown):boolean=>{if(!record(value))return Array.isArray(value)&&value.some(contains);return own(value,'preserve')||Object.entries(value).some(([key,v])=>((key==='item'||key==='recipeId')&&v==='preserve')||typeof v==='object'&&contains(v));};
 const offer=a.type==='accept'?w.offers.find(o=>o.id===a.offerId):undefined;
 return contains(a)||offer&&contains({give:offer.give,want:offer.want})?'本MVP尚不支持罐藏批次转移，不能用交换或赠予重置保存期限':null;
}
/** Only adoption may create unknown-old-stock entries. Any unproven increase
 * during execution aborts the MVP's transactional draft rather than silently
 * creating immortal transferred food. Decreases consume known FEFO first. */
export function reconcileMvpPreservation(w:World):void {
 const s=w.mvpPreservation;if(!s)return;
 for(const r of w.residents){const a=s.accounts[r.id];if(!a)throw Error('mvp_preservation_unknown_person');const held=preservationInventory(w,r).preserve??0;if(!integer(held))fail();let recorded=a.unknown+a.lots.reduce((sum,l)=>sum+l.quantity,0);
  if(held>recorded)throw Error('mvp_preservation_unproven_incoming');
  else if(held<recorded){let remove=recorded-held;for(const l of [...a.lots].sort((a,b)=>a.expiresAt-b.expiresAt||a.id.localeCompare(b.id))){const n=Math.min(remove,l.quantity);l.quantity-=n;l.removed+=n;remove-=n;if(!remove)break;}a.unknown-=remove;}
 }
}
export function advanceMvpPreservation(w:World,previousMinute:number):void {
 const s=w.mvpPreservation;if(!s){validateMvpPreservation(w);return;}
 validateMvpPreservation({...w,minute:previousMinute});if(w.minute<previousMinute)fail();
 for(const r of w.residents){const a=s.accounts[r.id],expired=a.lots.filter(l=>l.quantity>0&&l.expiresAt<=w.minute),spoiled=expired.reduce((sum,l)=>sum+l.quantity,0);if(!spoiled)continue;
  // A corpse may have moved. Its sealed stock has its own persistent location;
  // missing provenance must not be reconstructed from the body's current site.
  const location=r.status==='dead'?w.estates.find(e=>e.personId===r.id)?.location:{at:r.at,inside:r.inside,roomAt:r.roomAt??null};
  if(!location)throw Error('mvp_preservation_missing_estate_location');
  const stock=preservationInventory(w,r);for(const l of expired){l.spoiled+=l.quantity;l.quantity=0;}stock.preserve=(stock.preserve??0)-spoiled;r.revision++;r.decisionDue=Math.min(r.decisionDue,w.minute);
  const event={kind:'action' as const,actors:[r.id],place:{...location.at},roomId:location.inside,roomAt:location.roomAt?{...location.roomAt}:null,...('regional'in location&&location.regional?{regionalLocation:{...location.regional}}:{}),text:`${r.name}${r.status==='dead'?'封存遗产中':'随身'}的${spoiled}份已知罐藏达到56日保存期限，实际库存已扣除。`};
  // Estate expiry is an observer accounting fact, not news delivered from the
  // corpse's location. The ordinary emitter can relocate outside actors.
  if(r.status==='dead')emitLedgerEvent(w,event);else emitEvent(w,event);
 }
 s.lastMinute=w.minute;
}
export function completePreservation(w:World,r:Resident,a:PreservationAction):string|null {
 const reason=preservationReason(w,r,a,true);if(reason)return reason;
 const s=w.mvpPreservation!,id=r.activity?.mvpPreservationExecutionId;if(!r.activity||r.activity.remaining>1e-9||Math.abs((r.activity.mvpPreservationWorked??0)-PRESERVATION_WORK[a.operation])>1e-7)return '罐藏劳动尚未实际完成';if(!id||own(s.receipts,id))throw Error('mvp_preservation_duplicate_execution');
 for(const [item,n]of Object.entries(PRESERVATION_COST[a.operation]))r.inventory[item as keyof Resident['inventory']]!-=n;
 if(a.operation==='preserve'){r.inventory.preserve=(r.inventory.preserve??0)+2;s.accounts[r.id]!.lots.push({id,producedAt:w.minute,expiresAt:w.minute+PRESERVATION_LIFE,quantity:2,removed:0,spoiled:0});}
 const event=emitEvent(w,{kind:'production',actors:[r.id],place:{...r.at},roomId:r.inside,roomAt:{...r.roomAt!},text:a.operation==='install'?`${r.name}耗用本人6木6石、120分钟劳动，安装共用罐藏工位。`:`${r.name}耗用本人2果1水1木、60分钟劳动，制成2份有真实56日到期批次的罐藏。`});
 s.receipts[id]={actorId:r.id,operation:a.operation,at:w.minute,workMinutes:PRESERVATION_WORK[a.operation],eventId:event.id};if(a.operation==='install')s.installed={executionId:id,actorId:r.id,at:w.minute,eventId:event.id};return null;
}
export function preservationObservation(w:World){const s=w.mvpPreservation;if(!s)return;return {schemaVersion:1 as const,atMinute:w.minute,installed:!!s.installed,storageScope:'new-canned-lots-only' as const,rawFoodPerishability:'unmodeled' as const,winterReady:false as const,residents:w.residents.map(r=>{const a=s.accounts[r.id];return {actorId:r.id,container:r.status==='dead'?'sealed-estate' as const:'person' as const,unknownFreshness:a.unknown,knownQuantity:a.lots.reduce((n,l)=>n+l.quantity,0),knownNutrition:a.lots.reduce((n,l)=>n+l.quantity*26,0),lots:a.lots.filter(l=>l.quantity>0).map(l=>({id:l.id,quantity:l.quantity,producedAt:l.producedAt,expiresAt:l.expiresAt})),workOrdersToday:Object.values(s.attempts).filter(x=>x.actorId===r.id&&Math.floor(x.at/1440)===Math.floor(w.minute/1440)).length};})};}
