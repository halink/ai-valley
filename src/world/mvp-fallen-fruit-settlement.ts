import type {MvpGroundFruitState} from '../shared/mvp-ground-fruit.js';
import type {World} from '../shared/types.js';
import {
 mvpFallenFruitDiscoveryId,mvpFallenFruitPickupId,settledMvpFallenFruitEffectIds,
 type MvpFallenFruitSettlementLedger,type ValleySpiritFallenFruitDiscoveryFact,type ValleySpiritFallenFruitPickupFact,
} from '../shared/valley-spirit-fairness.js';
import {
 chooseMvpFallenFruitPickup,observeMvpFallenFruit,type MvpFallenFruitDecisionSlot,
 type MvpFallenFruitPickupIntent,
} from './mvp-fallen-fruit-resident.js';
import {minuteToClimateUs} from './mvp-climate.js';
import {validateMvpSpiritEffects} from './mvp-spirit-effects.js';

export type {MvpFallenFruitSettlementLedger} from '../shared/valley-spirit-fairness.js';

interface Draft<F> {
 readonly status:'draft';
 readonly expectedWorldRevision:number;
 readonly world:World;
 readonly ledger:MvpFallenFruitSettlementLedger;
 readonly fact:F;
}
interface Replayed<F> {readonly status:'replayed';readonly fact:F;}
type RejectCode = 'unavailable'|'capacity'|'not-observed'|'stale-intent'|'no-prior-discovery'|'already-picked'|'invalid-stock';
type Rejected = {readonly status:'rejected';readonly code:RejectCode};
const reject=(code:RejectCode):Rejected=>({status:'rejected',code});
type DiscoveryResult=Draft<ValleySpiritFallenFruitDiscoveryFact>|Replayed<ValleySpiritFallenFruitDiscoveryFact>|Rejected;
type PickupResult=(Draft<ValleySpiritFallenFruitPickupFact>&{
 readonly stock:{readonly effectId:string;readonly groundBefore:1;readonly groundAfter:0;
  readonly residentId:string;readonly fruitBefore:number;readonly fruitAfter:number};
})|Replayed<ValleySpiritFallenFruitPickupFact>|Rejected;

const CAP=4096; // wire bound, never a configured production quota; no pruning
const nat=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const ID=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u;
const EFFECT=/^valley-effect:[a-f0-9]{64}$/u;
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const has=(v:unknown,p:RegExp):v is string=>typeof v==='string'&&p.test(v);
const timeKey=/^(0|[1-9][0-9]{0,15})$/u;

function inspect(w:World,ledger:MvpFallenFruitSettlementLedger) {
 if(!w||!nat(w.revision)||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly'))return null;
 const effects=w.mvpClimate?.spiritEffects;
 if(!effects||w.mvpClimate?.lastUs!==minuteToClimateUs(w.minute))return null;
 const now=Number(minuteToClimateUs(w.minute));
 validateMvpSpiritEffects(w);
 const settled=settledMvpFallenFruitEffectIds(w.id,w.revision,now,effects.applied,ledger);
 return settled?{effects,now,settled}:null;
}

/** Verifies independently supplied settlement evidence against its effect head.
 * Does not prove that a caller actually committed inventory and the ledger in
 * one transaction; only the future write-boundary can establish that. */
export function validMvpFallenFruitSettlementLedger(w:World,ledger:unknown):ledger is MvpFallenFruitSettlementLedger {
 try{return inspect(w,ledger as MvpFallenFruitSettlementLedger)!==null;}catch{return false;}
}

/** Verified derived live stock. A consumed lot disappears from availability
 * without deleting immutable effect/birth records still needed on recovery. */
export function projectMvpFallenFruitLiveGround(w:World,ledger:MvpFallenFruitSettlementLedger):MvpGroundFruitState|null {
 try{
  const head=inspect(w,ledger);
  return head?{version:1,items:structuredClone(head.effects.ground.items.filter(item=>!head.settled.has(item.effectId)))}:null;
 }catch{return null;}
}

/** Build a separate world revision for the actual sighting, without setting
 * resident memories or sending notifications. Calling alone commits nothing. */
export function draftMvpFallenFruitDiscovery(
 w:World,ledger:MvpFallenFruitSettlementLedger,residentId:string,effectId:string,
):DiscoveryResult {
 try{
  const head=inspect(w,ledger);
  if(!head||!has(residentId,ID)||!has(effectId,EFFECT))return reject('unavailable');
  const discoveryId=mvpFallenFruitDiscoveryId(w.id,residentId,effectId);
  const prior=ledger.discoveries.find(f=>f.discoveryId===discoveryId);
  if(prior)return {status:'replayed',fact:structuredClone(prior)};
  if(ledger.discoveries.length>=CAP||!nat(w.revision+1))return reject('capacity');
  const actual=observeMvpFallenFruit(w,residentId,head.settled).find(s=>s.effectId===effectId&&s.discoveryId===discoveryId);
  if(!actual)return reject('not-observed');
  const lot=head.effects.ground.items.find(s=>s.effectId===effectId);
  if(!lot)return reject('not-observed');
  const world=structuredClone(w);
  world.revision++;
  const fact:ValleySpiritFallenFruitDiscoveryFact={schemaVersion:1,worldId:w.id,residentId,effectId,discoveryId,
   targetId:'ground:'+lot.at.x+':'+lot.at.y,discoveredAtMicroMinute:head.now,worldRevision:world.revision};
  return {status:'draft',expectedWorldRevision:w.revision,world,fact,ledger:structuredClone({
   ...ledger,discoveries:[...ledger.discoveries,fact],
  })};
 }catch{return reject('unavailable');}
}

const INTENT_KEYS=['schemaVersion','type','worldId','residentId','residentRevision','discoveryId','effectId','at',
 'observedAtUs','placedUs','expectedCustody','item','quantity'] as const;
function validIntent(v:unknown):v is MvpFallenFruitPickupIntent {
 return exact(v,INTENT_KEYS)&&v.schemaVersion===1&&v.type==='mvp-fallen-fruit-pickup-intent'&&has(v.worldId,ID)&&
  has(v.residentId,ID)&&nat(v.residentRevision)&&has(v.effectId,EFFECT)&&
  v.discoveryId===mvpFallenFruitDiscoveryId(v.worldId,v.residentId,v.effectId)&&exact(v.at,['x','y'])&&
  nat(v.at.x)&&nat(v.at.y)&&has(v.observedAtUs,timeKey)&&has(v.placedUs,timeKey)&&
  v.expectedCustody==='commons'&&v.item==='fruit'&&v.quantity===1;
}
function sameIntent(a:MvpFallenFruitPickupIntent,b:MvpFallenFruitPickupIntent):boolean {
 return INTENT_KEYS.every(k=>k==='at'?a.at.x===b.at.x&&a.at.y===b.at.y:a[k]===b[k]);
}

/** Trusted integration must obtain the slot from the independent resident
 * chooser's genuine idle fallback. Reconstruct the current exact intent; neither
 * an old view nor an arbitrary wait provides it. These drafts are not authority
 * or durable effects until the store rechecks and atomically commits both. */
export function draftMvpFallenFruitPickup(
 w:World,ledger:MvpFallenFruitSettlementLedger,authorizedIntent:MvpFallenFruitPickupIntent,
 ordinaryDecisionSlot:MvpFallenFruitDecisionSlot,
):PickupResult {
 try{
  const head=inspect(w,ledger);
  if(!head)return reject('unavailable');
  if(ordinaryDecisionSlot!=='idle-fallback'||!validIntent(authorizedIntent)||authorizedIntent.worldId!==w.id)
   return reject('stale-intent');
  const intent=authorizedIntent;
  const lot=head.effects.ground.items.find(f=>f.effectId===intent.effectId);
  if(!lot||lot.placedUs!==intent.placedUs||lot.at.x!==intent.at.x||lot.at.y!==intent.at.y)return reject('stale-intent');
  const previously=ledger.pickups.find(p=>p.effectId===intent.effectId);
  if(previously)return previously.residentId===intent.residentId&&previously.discoveryId===intent.discoveryId
   ?{status:'replayed',fact:structuredClone(previously)}:reject('already-picked');
  if(ledger.pickups.length>=CAP||!nat(w.revision+1))return reject('capacity');
  const actual=chooseMvpFallenFruitPickup(w,intent.residentId,ordinaryDecisionSlot,head.settled);
  if(!actual||!sameIntent(intent,actual))return reject('stale-intent');
  const discovery=ledger.discoveries.find(f=>f.discoveryId===intent.discoveryId);
  if(!discovery||discovery.residentId!==intent.residentId||discovery.effectId!==intent.effectId||discovery.worldRevision>w.revision)
   return reject('no-prior-discovery');
  const resident=w.residents.find(r=>r.id===intent.residentId)!;
  const fruitBefore=resident.inventory.fruit===undefined?0:resident.inventory.fruit;
  if(!nat(fruitBefore)||!nat(fruitBefore+1)||!nat(resident.revision+1))return reject('invalid-stock');
  const world=structuredClone(w),receiver=world.residents.find(r=>r.id===intent.residentId)!;
  world.revision++;
  receiver.revision++;
  receiver.inventory.fruit=fruitBefore+1;
  const fact:ValleySpiritFallenFruitPickupFact={schemaVersion:1,worldId:w.id,residentId:intent.residentId,
   effectId:intent.effectId,discoveryId:intent.discoveryId,pickupId:mvpFallenFruitPickupId(w.id,intent.effectId),
   targetId:discovery.targetId,settledAtMicroMinute:head.now,worldRevision:world.revision,
   previousGroundCustody:'commons',item:'fruit',debitGroundFruit:1,creditResidentFruit:1};
  return {status:'draft',expectedWorldRevision:w.revision,world,fact,ledger:structuredClone({...ledger,pickups:[...ledger.pickups,fact]}),
   stock:{effectId:intent.effectId,groundBefore:1,groundAfter:0,residentId:intent.residentId,fruitBefore,fruitAfter:fruitBefore+1}};
 }catch{return reject('unavailable');}
}
