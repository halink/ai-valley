import {createHash} from 'node:crypto';
import {
 currentValleySpiritLifeFacts,
 projectValleySpiritLifeFacts,
 type ValleySpiritLifeAuthority,
 type ValleySpiritLifeFact,
 type ValleySpiritLifeFactPacket,
} from './valley-spirit-life-facts.js';

const SCHEMA=1 as const,RENDERER=1 as const;
const MAX_FACTS=8;
const WHOLE_DAY=1_440_000_000n;
const MAX_US=1_000_000_000_000_000n;
const clock=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&BigInt(v)<=MAX_US;
const exact=(v:unknown,k:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===k.length&&k.every(key=>Object.hasOwn(v,key));
const CLOCK_RANGE_KEYS=['fromUs','throughUs'] as const;
const PACKET_KEYS=['schemaVersion','mode','range','source'] as const;
const SECTION_KEYS=['schemaVersion','rendererVersion','sectionId','packet','selection','lines'] as const;
const orderings=['time-first','fact-first'] as const;
type Wording=typeof orderings[number];
export interface ValleySpiritLifeAlmanacRange {readonly fromUs:string;readonly throughUs:string;}
export interface ValleySpiritLifeAlmanacPacket {
 readonly schemaVersion:1;
 readonly mode:'public-life-almanac';
 readonly range:ValleySpiritLifeAlmanacRange;
 readonly source:ValleySpiritLifeFactPacket;
}
interface Selection {readonly indices:readonly number[];readonly wording:Wording;}
export interface ValleySpiritLifeAlmanacLine {
 readonly sourceRef:string;
 readonly grantVersion:number;
 readonly receiptVersion:number;
 readonly atUs:string;
 readonly kind:ValleySpiritLifeFact['kind'];
 readonly text:string;
}
/** Private persisted draft contents. Not itself proof of publication. */
export interface ValleySpiritLifeAlmanacSection {
 readonly schemaVersion:1;
 readonly rendererVersion:1;
 readonly sectionId:string;
 readonly packet:ValleySpiritLifeAlmanacPacket;
 readonly selection:Selection;
 readonly lines:readonly ValleySpiritLifeAlmanacLine[];
}
const labels:Record<ValleySpiritLifeFact['kind'],string>={
 arrived:'记录到一次实际到场',
 'conversation-completed':'记录到一次已实际送达的交谈',
 'meal-consumed':'记录到一次实际进餐',
};
function bounds(range:unknown):range is ValleySpiritLifeAlmanacRange {
 return exact(range,CLOCK_RANGE_KEYS)&&clock(range.fromUs)&&clock(range.throughUs)&&BigInt(range.throughUs)>=BigInt(range.fromUs)&&
  BigInt(range.throughUs)-BigInt(range.fromUs)<=WHOLE_DAY;
}
function rangeContains(range:ValleySpiritLifeAlmanacRange,value:string):boolean {
 const at=BigInt(value);
 return at>=BigInt(range.fromUs)&&at<=BigInt(range.throughUs);
}
function selection(raw:unknown,total:number):Selection|null{
 if(!exact(raw,['indices','wording'])||!Array.isArray(raw.indices)||raw.indices.length<1||raw.indices.length>MAX_FACTS||
  !orderings.some(w=>w===raw.wording))return null;
 const indices=[...raw.indices];
 if(!indices.every(n=>Number.isSafeInteger(n)&&n>=1&&n<=total)||new Set(indices).size!==indices.length)return null;
 return {indices:Object.freeze(indices),wording:raw.wording as Wording};
}
function exactGameMinute(value:string):string{
 const whole=BigInt(value)/1_000_000n,part=BigInt(value)%1_000_000n;
 return part===0n?String(whole):String(whole)+'.'+String(part).padStart(6,'0').replace(/0+$/,'');
}
function renderLifeLine(f:{kind:ValleySpiritLifeFact['kind'];atUs:string},wording:Wording):string{
 const fact=labels[f.kind],time='游戏分钟 '+exactGameMinute(f.atUs);
 return wording==='time-first'?time+'：'+fact+'。':fact+'（'+time+'）。';
}
/** Existing objective renderer for the independently governed private one-line
 * conversation edition. No identity, original utterance or source ID. */
export function renderObjectiveDeliveredConversation(atUs:string){
 if(!clock(atUs))return null;
 const kind='conversation-completed' as const;
 return Object.freeze({atUs,kind,text:renderLifeLine({atUs,kind},'time-first')});
}
/** Disclosure is day-bucketed; exact timestamps only enter private custody. */
export function renderObjectiveNativeMeal(observedAtUs:string){
 if(!clock(observedAtUs))return null;
 const dayLengthUs=1_440_000_000n,day=BigInt(observedAtUs)/dayLengthUs;
 return Object.freeze({atUs:String(day*dayLengthUs),kind:'meal-consumed' as const,text:`第 ${day+1n} 日：有人用过一餐。`});
}
/** Local signed hearing is a fixed day-bucketed fact, never an utterance or reply. */
export function renderObjectiveNativeHearing(observedAtUs:string){
 if(!clock(observedAtUs))return null;
 const dayLengthUs=1_440_000_000n,day=BigInt(observedAtUs)/dayLengthUs;
 return Object.freeze({atUs:String(day*dayLengthUs),kind:'conversation-completed' as const,text:`第 ${day+1n} 日：一次当面发言被听见。`});
}
function canonicalSection(packet:ValleySpiritLifeAlmanacPacket,choice:Selection):ValleySpiritLifeAlmanacSection{
 const lines=choice.indices.map(n=>{
  const f=packet.source.facts[n-1];
  return Object.freeze({sourceRef:f.sourceRef,grantVersion:f.grantVersion,receiptVersion:f.receiptVersion,
   atUs:f.atUs,kind:f.kind,text:renderLifeLine(f,choice.wording)});
 });
 const sectionId='valley-life-section-'+createHash('sha256').update(JSON.stringify([SCHEMA,RENDERER,packet,choice,lines])).digest('hex');
 return Object.freeze({schemaVersion:SCHEMA,rendererVersion:RENDERER,sectionId,packet,selection:Object.freeze(choice),lines:Object.freeze(lines)});
}
/** Internal, default-off life source seam. No scheduler, transport or store
 * capability. Formatting is deterministic; no free-form model wording is
 * accepted and this module never claims authorship or publication. */
export class ValleySpiritLifeAlmanac {
 constructor(private readonly authority:ValleySpiritLifeAuthority,private readonly mode?:'grounded-public-life-dev'){}
 prepare(worldId:string,range:ValleySpiritLifeAlmanacRange,refs:readonly string[]):ValleySpiritLifeAlmanacPacket|null {
  try{
   if(this.mode!=='grounded-public-life-dev'||!bounds(range))return null;
   const source=projectValleySpiritLifeFacts(this.authority,worldId,refs);
   if(!source||source.facts.some(f=>!rangeContains(range,f.atUs)))return null;
   return Object.freeze({schemaVersion:SCHEMA,mode:'public-life-almanac',range:Object.freeze({fromUs:range.fromUs,throughUs:range.throughUs}),source});
  }catch{return null;}
 }
 /** Trusted caller checks again immediately before outbound handoff. */
 authorize(value:unknown):value is ValleySpiritLifeAlmanacPacket {
  try{
   if(this.mode!=='grounded-public-life-dev'||!exact(value,PACKET_KEYS)||value.schemaVersion!==SCHEMA||
    value.mode!=='public-life-almanac'||!bounds(value.range))return false;
   const source=value.source as ValleySpiritLifeFactPacket,range=value.range;
   return currentValleySpiritLifeFacts(this.authority,source)&&source.facts.every(f=>rangeContains(range,f.atUs));
  }catch{return false;}
 }
 /** The caller persists/render only an exact choice against current facts. The
  * complete packet remains the authorization basis, even facts not selected. */
 ground(packet:unknown,rawChoice:unknown):ValleySpiritLifeAlmanacSection|null{
  try{
   if(!this.authorize(packet))return null;
   const choice=selection(rawChoice,packet.source.facts.length);
   if(!choice)return null;
   // Normalize freshly on the trusted path; do not hold caller-owned objects in draft.
   const copy=JSON.parse(JSON.stringify(packet)) as ValleySpiritLifeAlmanacPacket;
   Object.freeze(copy.range);for(const f of copy.source.facts)Object.freeze(f);
   Object.freeze(copy.source.facts);Object.freeze(copy.source);Object.freeze(copy);
   return canonicalSection(copy,choice);
  }catch{return null;}
 }
 /** Use on every published, indexed or exported reading. A revoked, replaced
  * or tampered source hides the entire section, not just the selected line. */
 read(section:unknown):{readonly sectionId:string;readonly lines:readonly ValleySpiritLifeAlmanacLine[]}|null {
  try{
   if(!exact(section,SECTION_KEYS)||section.schemaVersion!==SCHEMA||section.rendererVersion!==RENDERER)return null;
   const checked=this.ground(section.packet,section.selection);
   if(!checked||JSON.stringify(section)!==JSON.stringify(checked))return null;
   return Object.freeze({sectionId:checked.sectionId,lines:checked.lines});
  }catch{return null;}
 }
}
