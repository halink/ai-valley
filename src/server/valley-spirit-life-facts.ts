import {createHash} from 'node:crypto';

const PROJECTION_VERSION = 1 as const;
const MAX_BATCH = 24;
const WORLD = /^godot-mvp-[a-zA-Z0-9_-]{1,180}$/;
const RECEIPT = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const US = /^(0|[1-9][0-9]{0,15})$/;
const hex = /^[a-f0-9]{64}$/;
const clean = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v: unknown, keys: readonly string[]) => clean(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const version = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v>=1;
const clock = (v: unknown): v is string => typeof v === 'string' && US.test(v) && BigInt(v)<=1_000_000_000_000_000n;
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const completionKinds = ['arrived', 'conversation-completed', 'meal-consumed'] as const;
type CompletionKind = typeof completionKinds[number];

/** Typed internal fact supplied by a committed-receipt adapter, not WorldEvent.
 * Each kind has a separate effect/receipt. An arrival isn't evidence of talk
 * or eating; a conversation receipt must represent actual speech + reception,
 * and a meal receipt must represent actual inventory consumption. */
export interface ValleySpiritLifeReceipt {
 readonly schemaVersion:1;
 readonly worldId:string;
 /** Persisted random UUIDv4 issued for this typed receipt. Not the actor,
  * original WorldEvent ID, dialogue ID, or mutable row position. */
 readonly receiptId:string;
 readonly kind:CompletionKind;
 readonly atUs:string;
 readonly receiptVersion:number;
}
export interface ValleySpiritLifeFact {
 readonly projectionVersion:1;
 readonly sourceRef:string;
 readonly grantVersion:number;
 readonly receiptVersion:number;
 readonly kind:CompletionKind;
 readonly atUs:string;
}
export interface ValleySpiritLifeFactPacket {
 readonly projectionVersion:1;
 readonly mode:'public-completed-life-facts';
 readonly worldId:string;
 readonly facts:readonly ValleySpiritLifeFact[];
}
interface PublicGrant {
 readonly audience:'valley-spirit-public';
 readonly status:'granted';
 readonly grantVersion:number;
 readonly worldId:string;
 readonly sourceRef:string;
 readonly receiptVersion:number;
 readonly receiptDigest:string;
}
/** A single coherent, current, read-only source/grant read. Adapters must use
 * authoritative persisted receipts + explicit per-source grant, never working
 * arrays, UI visibility, inferred consent, or model/injected narration. */
export interface ValleySpiritLifeAuthority {
 readCurrent(worldId:string,sourceRefs:readonly string[]):unknown;
}
const receiptKeys = ['schemaVersion','worldId','receiptId','kind','atUs','receiptVersion'] as const;
const grantKeys = ['audience','status','grantVersion','worldId','sourceRef','receiptVersion','receiptDigest'] as const;

export function isValleySpiritLifeReceipt(value:unknown):value is ValleySpiritLifeReceipt {
 if(!exact(value,receiptKeys))return false;
 const r=value as ValleySpiritLifeReceipt;
 return r.schemaVersion===1&&typeof r.worldId==='string'&&WORLD.test(r.worldId)&&typeof r.receiptId==='string'&&RECEIPT.test(r.receiptId)&&
  completionKinds.includes(r.kind)&&clock(r.atUs)&&version(r.receiptVersion);
}

export function valleySpiritLifeBinding(receipt:ValleySpiritLifeReceipt) {
 if(!isValleySpiritLifeReceipt(receipt))throw new TypeError('invalid ValleySpirit life receipt');
 return {
  sourceRef:`${receipt.worldId}/life-${sha([receipt.worldId,receipt.kind,receipt.receiptId])}`,
  receiptDigest:sha([receipt.schemaVersion,receipt.worldId,receipt.kind,receipt.receiptId,receipt.receiptVersion,receipt.atUs]),
 };
}
const validRef = (ref:unknown,world:string):ref is string => typeof ref==='string'&&ref.startsWith(world+'/life-')&&hex.test(ref.slice(world.length+6));

/** Only isolated schema and actual permitted values are returned; any missing,
 * revoked, corrected-to-a-different-receipt, mismatched or unknown row denies
 * the whole batch without substitution. The source ref exposes no receipt ID. */
export function projectValleySpiritLifeFacts(authority:ValleySpiritLifeAuthority,worldId:string,refs:readonly string[]):ValleySpiritLifeFactPacket|null {
 if(typeof worldId!=='string'||!WORLD.test(worldId)||!Array.isArray(refs)||refs.length<1||refs.length>MAX_BATCH)return null;
 try {
  const sourceRefs=[...refs];
  if(!sourceRefs.every(ref=>validRef(ref,worldId))||new Set(sourceRefs).size!==sourceRefs.length)return null;
  const snapshot=authority.readCurrent(worldId,Object.freeze(sourceRefs));
  if(!exact(snapshot,['schemaVersion','worldId','asOfUs','rows']))return null;
  const s=snapshot as {schemaVersion:unknown; worldId:unknown; asOfUs:unknown; rows:unknown};
  if(s.schemaVersion!==1||s.worldId!==worldId||!clock(s.asOfUs)||!Array.isArray(s.rows)||s.rows.length!==sourceRefs.length)return null;
  const facts:ValleySpiritLifeFact[]=[];
  for(const [index,row] of s.rows.entries()){
   if(!exact(row,['receipt','grant'])||!isValleySpiritLifeReceipt(row.receipt)||row.receipt.worldId!==worldId||BigInt(row.receipt.atUs)>BigInt(s.asOfUs)||!exact(row.grant,grantKeys))return null;
   const grant=row.grant as PublicGrant, receipt=row.receipt;
   const binding=valleySpiritLifeBinding(receipt);
   if(grant.audience!=='valley-spirit-public'||grant.status!=='granted'||!version(grant.grantVersion)||
    grant.worldId!==worldId||grant.sourceRef!==sourceRefs[index]||binding.sourceRef!==grant.sourceRef||
    grant.receiptVersion!==receipt.receiptVersion||grant.receiptDigest!==binding.receiptDigest)return null;
   facts.push(Object.freeze({projectionVersion:PROJECTION_VERSION,sourceRef:binding.sourceRef,grantVersion:grant.grantVersion,
    receiptVersion:receipt.receiptVersion,kind:receipt.kind,atUs:receipt.atUs}));
  }
  return Object.freeze({projectionVersion:PROJECTION_VERSION,mode:'public-completed-life-facts',worldId,facts:Object.freeze(facts)});
 } catch {return null;}
}

/** Re-evaluate before outsiders receive anything, before publication, and on
 * every cache/index/export/old-link read; false means hide the complete result. */
export function currentValleySpiritLifeFacts(authority:ValleySpiritLifeAuthority,value:ValleySpiritLifeFactPacket):boolean {
 try{
  if(!exact(value,['projectionVersion','mode','worldId','facts'])||value.projectionVersion!==1||value.mode!=='public-completed-life-facts'||
   !Array.isArray(value.facts)||value.facts.length<1||value.facts.length>MAX_BATCH)return false;
  for(const f of value.facts)if(!exact(f,['projectionVersion','sourceRef','grantVersion','receiptVersion','kind','atUs']))return false;
  const current=projectValleySpiritLifeFacts(authority,value.worldId,value.facts.map(f=>f.sourceRef));
  if(!current)return false;
  return current.facts.every((f,i)=>{
   const submitted=value.facts[i];
   return submitted.projectionVersion===f.projectionVersion&&submitted.sourceRef===f.sourceRef&&submitted.grantVersion===f.grantVersion&&
    submitted.receiptVersion===f.receiptVersion&&submitted.kind===f.kind&&submitted.atUs===f.atUs;
  });
 }catch{return false;}
}
