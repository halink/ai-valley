import type {MvpClimateState,MvpRainEpisode} from '../shared/mvp-climate.js';
import type {World,WorldEvent} from '../shared/types.js';
import {validValleySpiritFruitFallReceipt,type MvpSpiritEffects} from '../shared/valley-spirit-effects.js';
import {minuteToClimateUs,parseClimateUs} from './mvp-climate.js';
import {inspectMvpGroundFruitPlacement,validateMvpGroundFruitState,type MvpGroundFruitCapacity} from './mvp-ground-fruit.js';
import {resolveMvpRainEpisode} from './mvp-rain-provenance.js';
import {same} from './navigation.js';

const MARKER='spiritEffects',EVENT='mvpFruitFall';
export const MVP_FRUIT_FALL_EVENT_TEXT='雨后在地面留下一份公共落果。';
const LIMIT=4096; // Safety ceiling. Committed effects must never be pruned here.
const own=(v:object,k:string)=>Object.hasOwn(v,k);
const exact=(v:unknown,keys:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>own(v,k));
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

export function hasMvpSpiritEffects(climate:MvpClimateState|undefined):boolean {
 return !!climate&&typeof climate==='object'&&own(climate,MARKER);
}
export function hasMvpSpiritEffectEvents(value:unknown):boolean {
 return Array.isArray(value)&&value.some(e=>e&&typeof e==='object'&&own(e,EVENT));
}
export function validMvpSpiritFixtureCapacity(value:unknown):value is MvpGroundFruitCapacity {
 const cap=value as MvpGroundFruitCapacity;
 return exact(value,['worldLots','lotsPerTarget'])&&natural(cap.worldLots)&&cap.worldLots<=LIMIT&&
  natural(cap.lotsPerTarget)&&cap.lotsPerTarget<=cap.worldLots;
}
function validEffectRain(world:World,rain:MvpRainEpisode,rainEventId:string,placement:bigint):boolean {
 if(!exact(rain,['rainEventId','startedUs','firstRainUs','endedUs'])||rain.rainEventId!==rainEventId||
  rainEventId!==world.id+':rain:'+rain.startedUs)return false;
 const start=parseClimateUs(rain.startedUs),first=parseClimateUs(rain.firstRainUs),end=parseClimateUs(rain.endedUs);
 return start>=parseClimateUs(world.mvpClimate!.rainProvenance!.adoptedUs)&&start<=first&&first<end&&
  end<=placement;
}

/** Validation for known isolated v1 data only; no recovery from inferred weather,
 * no receipt resurrection and no pickup/removal until that schema is implemented. */
export function validateMvpSpiritEffects(world:World):void {
 if(!hasMvpSpiritEffects(world.mvpClimate)){
  if(hasMvpSpiritEffectEvents(world.events))throw Error('mvp_spirit_unattached_effect_event');
  return;
 }
 const value=world.mvpClimate!.spiritEffects;
 if(world.schemaVersion===2||!world.mvpClimate!.rainProvenance||
  !exact(value,['version','adoptedUs','ground','applied'])||value?.version!==1||
  !Array.isArray(value.applied)||value.applied.length>LIMIT||!Array.isArray(world.events))
  throw Error('mvp_spirit_unsupported_state');
 const state=value as MvpSpiritEffects,adopted=parseClimateUs(state.adoptedUs),now=parseClimateUs(minuteToClimateUs(world.minute));
 if(adopted<parseClimateUs(world.mvpClimate!.rainProvenance.adoptedUs)||adopted>now)throw Error('mvp_spirit_effect_adoption_clock');
 validateMvpGroundFruitState(world,state.ground);
 const receipts=state.applied;
 if(state.ground.items.length!==receipts.length)throw Error('mvp_spirit_effect_item_mismatch');
 const events=new Map<string,WorldEvent>();
 for(const event of world.events){
  if(!event||typeof event!=='object'||!own(event,EVENT))continue;
  const note=event.mvpFruitFall;
  if(!exact(note,['version','effectId'])||note?.version!==1||typeof note.effectId!=='string'||events.has(note.effectId))
   throw Error('mvp_spirit_invalid_effect_event');
  events.set(note.effectId,event);
 }
 if(events.size!==receipts.length)throw Error('mvp_spirit_effect_event_mismatch');

 const lots=new Map(state.ground.items.map(item=>[item.effectId,item]));
 const opportunityIds=new Set<string>(),proposalIds=new Set<string>(),eventIds=new Set<string>();
 let last=adopted;
 for(const entry of receipts){
  if(!exact(entry,['receipt','rain','eventId','sourceBefore','sourceAfter'])||
   !validValleySpiritFruitFallReceipt(entry.receipt)||typeof entry.eventId!=='string'||
   !natural(entry.sourceBefore)||!natural(entry.sourceAfter)||entry.sourceBefore-entry.sourceAfter!==1)
   throw Error('mvp_spirit_invalid_effect_receipt');
  const receipt=entry.receipt,time=parseClimateUs(String(receipt.committedAtMicroMinute));
  if(receipt.worldId!==world.id||receipt.ownerId!=='commons'||time<last||time>now||
   opportunityIds.has(receipt.opportunityId)||proposalIds.has(receipt.proposalId)||eventIds.has(entry.eventId)||
   !validEffectRain(world,entry.rain,receipt.rainEventId,time))
   throw Error('mvp_spirit_invalid_effect_provenance');
  const lot=lots.get(receipt.effectId),event=events.get(receipt.effectId);
  if(!lot||lot.rainEventId!==receipt.rainEventId||lot.sourceResourceInstanceId!==receipt.sourceResourceInstanceId||
   receipt.targetId!==`ground:${lot.at.x}:${lot.at.y}`||lot.placedUs!==String(receipt.committedAtMicroMinute))
   throw Error('mvp_spirit_effect_item_mismatch');
  const eventPrefix=world.id+':event:',eventSequence=entry.eventId.slice(eventPrefix.length);
  if(!event||!exact(event,['id','at','kind','actors','place','text','witnesses','observerOnly',EVENT])||
   !exact(event.place,['x','y'])||event.text!==MVP_FRUIT_FALL_EVENT_TEXT||
   event.id!==entry.eventId||!event.id.startsWith(eventPrefix)||!/^[1-9][0-9]{0,15}$/.test(eventSequence)||
   Number(eventSequence)>world.revision||event.kind!=='system'||event.observerOnly!==true||
   !Array.isArray(event.actors)||event.actors.length!==0||!Array.isArray(event.witnesses)||event.witnesses.length!==0||
   !event.place||!same(event.place,lot.at)||minuteToClimateUs(event.at)!==lot.placedUs)
   throw Error('mvp_spirit_effect_event_mismatch');
  lots.delete(receipt.effectId);opportunityIds.add(receipt.opportunityId);proposalIds.add(receipt.proposalId);eventIds.add(entry.eventId);
  last=time;
 }
}

function comparableWorld(world:World){
 const {mvpClimate,resources,events,revision,...other}=world;
 if(!mvpClimate)return {other,climate:null};
 const {spiritEffects,...climate}=mvpClimate;
 return {other,climate};
}
function prefixUnchanged(before:readonly unknown[],after:readonly unknown[]):boolean {
 return after.length>=before.length&&before.every((value,i)=>equal(value,after[i]));
}
/** Checked inside the same SQLite transaction as world state and event rows.
 * No normal runtime path has the fixture capacity capability. */
export function assertMvpSpiritEffectsAdvance(
 previous:World|null,next:World,capacity:MvpGroundFruitCapacity,
):void {
 const before=previous?.mvpClimate?.spiritEffects,after=next.mvpClimate?.spiritEffects;
 if(!before&&!after)return;
 if(!previous||!after)throw Error('mvp_spirit_effect_dependency_downgrade');
 if(!before){
  if(after.applied.length||after.ground.items.length||after.adoptedUs!==minuteToClimateUs(previous.minute)||
   next.revision!==previous.revision+1||!equal(comparableWorld(previous),comparableWorld(next))||
   !equal(previous.resources,next.resources)||!equal(previous.events,next.events))
   throw Error('mvp_spirit_invalid_effect_adoption');
  return;
 }
 if(after.adoptedUs!==before.adoptedUs||!prefixUnchanged(before.applied,after.applied)||
   !prefixUnchanged(before.ground.items,after.ground.items))throw Error('mvp_spirit_effect_history_changed');
 if(after.applied.length===before.applied.length)return;
 if(after.applied.length!==before.applied.length+1||after.ground.items.length!==before.ground.items.length+1||
   next.revision!==previous.revision+1||!equal(comparableWorld(previous),comparableWorld(next))||
   !prefixUnchanged(previous.events,next.events)||next.events.length!==previous.events.length+1)
   throw Error('mvp_spirit_effect_requires_dedicated_transaction');
 const {receipt,rain,eventId,sourceBefore,sourceAfter}=after.applied.at(-1)!;
 const lot=after.ground.items.at(-1)!;
 const pinnedRain=resolveMvpRainEpisode(previous,receipt.rainEventId);
 const head=inspectMvpGroundFruitPlacement(previous,before.ground,lot.sourceResourceId,lot.at,capacity);
 if(lot.effectId!==receipt.effectId||minuteToClimateUs(previous.minute)!==lot.placedUs||
   !pinnedRain||!equal(pinnedRain,rain)||!head||head.source.resourceInstanceId!==lot.sourceResourceInstanceId||
   head.source.ripeAvailable!==sourceBefore||next.events.at(-1)?.id!==eventId)
   throw Error('mvp_spirit_effect_basis_changed');
 const checkedResources=previous.resources.map(resource=>resource.id===lot.sourceResourceId?{...resource,amount:sourceAfter}:resource);
 if(!equal(checkedResources,next.resources))throw Error('mvp_spirit_effect_stock_mismatch');
}
