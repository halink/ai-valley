import {createHash} from 'node:crypto';
import type {PublicWeatherFact} from './valley-spirit.js';

const VERSION = 1 as const;
export const ALMANAC_ENTRY_SCHEMA = 3 as const;
const TEXT_RENDERER_VERSION = 1 as const;
const ORIGIN_SCHEMA = 1 as const;
const KNOWN_ORIGINS = ['offline-synthetic','unverified-admission'] as const;
type ValleySpiritAlmanacOrigin = {schemaVersion:1;kind:typeof KNOWN_ORIGINS[number]};
const MAX_SOURCES = 24;
const MAX_CLAIMS = 24;
const CONDITIONS = ['sun','cloud','rain','snow','mixed'] as const;
const MOODS = ['quiet','reflective','plain'] as const;
const WORDINGS = ['time-first','field-first'] as const;
const FIELDS = ['condition','temperatureDeciC','relativeHumidityPermille'] as const;
type Condition = typeof CONDITIONS[number];
type Mood = typeof MOODS[number];
type Field = typeof FIELDS[number];

export interface ValleySpiritAlmanacWeatherSource {sourceRef:string;permissionVersion:number;fact:PublicWeatherFact;}
export interface ValleySpiritAlmanacAuthority {
 permission(): {version:number;publicWeather:boolean}|null;
 resolve(sourceRef:string): ValleySpiritAlmanacWeatherSource|null;
 /** Atomically read a verified permission anchor and ordered evidence with one
  * journal read. A denied/unavailable batch must return null, not fall back. */
 readCurrent?(sourceRefs:readonly string[]):{
  worldId:string;permissionVersion:number;records:readonly ValleySpiritAlmanacWeatherSource[];
 }|null;
}
export interface ValleySpiritAlmanacRange {
 worldId:string; fromMinute:number; throughMinute:number; sourceRefs:readonly string[];
}
interface WeatherPoint {
 sourceRef:string; minute:number; condition:Condition; temperatureDeciC:number; relativeHumidityPermille:number;
}
export interface ValleySpiritAlmanacPacket {
 schemaVersion:1; projectionVersion:1; permissionVersion:number; worldId:string;
 fromMinute:number; throughMinute:number; coverage:'selected-actual-points-only';
 unselectedHourBuckets:number[]; points:WeatherPoint[];
}
interface Claim {sourceRef:string; field:Field; value:Condition|number;}
type Wording = typeof WORDINGS[number];
interface GroundedDraft {claims:Claim[]; atmosphere:Mood; wording:Wording;}
interface RenderedAlmanac {
 rendererVersion:1; facts:(Claim&{minute:number;text:string})[];
 atmosphere:{kind:'editorial-register-only';value:Mood};
}
type Phase = 'dispatch-intent'|'sent-unknown'|'discarded'|'grounded'|'published'|'retracted';
type Failure = 'permission'|'invalid-draft'|'not-sent'|'source-correction';
export interface ValleySpiritAlmanacEntry {
 schemaVersion:3; entryId:string; textVersion:number; supersedes:string|null;
 packet:ValleySpiritAlmanacPacket; phase:Phase; draft:GroundedDraft|null;
 failure:Failure|null; rendered:RenderedAlmanac|null; origin:ValleySpiritAlmanacOrigin;
}
/** Compare-and-replace is synchronous/atomic and must durably commit before
 * returning true. A foreign/unknown/corrupt store must throw and remain frozen. */
export interface ValleySpiritAlmanacStore {
 read(): readonly ValleySpiritAlmanacEntry[];
 replace(previous:readonly ValleySpiritAlmanacEntry[],next:readonly ValleySpiritAlmanacEntry[]):boolean;
}
/** Only explicitly configured, account-shared admission may implement this.
 * While obtaining an account slot, it must not dispatch or receive the packet.
 * send is single-use by adapter contract; no automatic sends/retries.
 * After any provider-preparation await, the adapter must call
 * authorizeDelivery immediately before actual transport handoff. If false,
 * it must not send and must settle the reservation as demonstrably unsent. */
export interface ValleySpiritAlmanacAdmission {
 reserve(request:{purpose:'valley-spirit-almanac'; requestId:string; packetBytes:number; promptVersion:1}):
  Promise<{cancelUnsent:()=>void; send:(packet:Readonly<ValleySpiritAlmanacPacket>,authorizeDelivery:()=>boolean)=>Promise<unknown>}|null>;
}
// The controlled offline scheduler obtains this in-process capability only
// after its explicit synthetic shared-account gate. No response or store JSON
// can claim production attribution. An ordinary injected admission is unverified.
const OFFLINE_ADMISSIONS = new WeakSet<ValleySpiritAlmanacAdmission>();
export function syntheticValleySpiritAlmanacAdmission(reserve:ValleySpiritAlmanacAdmission['reserve']):ValleySpiritAlmanacAdmission {
 const admission=Object.freeze({reserve});
 OFFLINE_ADMISSIONS.add(admission);return admission;
}
function originOf(admission:ValleySpiritAlmanacAdmission):ValleySpiritAlmanacOrigin {
 return {schemaVersion:ORIGIN_SCHEMA,kind:OFFLINE_ADMISSIONS.has(admission)?'offline-synthetic':'unverified-admission'};
}
const rec=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:readonly string[])=>rec(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const integer=(v:unknown,low:number,high:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=low&&v<=high;
const option=<T extends string>(values:readonly T[],v:unknown):v is T=>typeof v==='string'&&values.some(i=>i===v);
const minute=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const world=(v:unknown):v is string=>typeof v==='string'&&/^godot-mvp-[a-zA-Z0-9_-]{1,188}$/.test(v);
const sourceId=(w:string,v:unknown):v is string=>typeof v==='string'&&v.startsWith(w+'/')&&/^weather-[1-9][0-9]{0,15}-[0-9]{1,9}$/.test(v.slice(w.length+1));
const byMinute=(a:WeatherPoint,b:WeatherPoint)=>a.minute-b.minute||(a.sourceRef<b.sourceRef?-1:a.sourceRef>b.sourceRef?1:0);
const serial=(v:unknown)=>JSON.stringify(v);
const phases=['dispatch-intent','sent-unknown','discarded','grounded','published','retracted'] as const;
const failures=['permission','invalid-draft','not-sent','source-correction'] as const;
function unselectedBuckets(from:number,through:number,points:readonly WeatherPoint[]):number[] {
 const occupied=new Set(points.map(p=>Math.floor(p.minute/60)));
 return Array.from({length:Math.floor(through/60)-Math.floor(from/60)+1},(_,i)=>Math.floor(from/60)+i).filter(h=>!occupied.has(h));
}
function validPacket(v:unknown):v is ValleySpiritAlmanacPacket {
 if(!exact(v,['schemaVersion','projectionVersion','permissionVersion','worldId','fromMinute','throughMinute','coverage','unselectedHourBuckets','points']))return false;
 const p=v as ValleySpiritAlmanacPacket;
 if(p.schemaVersion!==1||p.projectionVersion!==1||p.coverage!=='selected-actual-points-only'||!world(p.worldId)||!integer(p.permissionVersion,1,Number.MAX_SAFE_INTEGER)||!minute(p.fromMinute)||!minute(p.throughMinute)||p.throughMinute<p.fromMinute||Math.floor(p.throughMinute/60)-Math.floor(p.fromMinute/60)>=MAX_SOURCES||!Array.isArray(p.points)||!p.points.length||p.points.length>MAX_SOURCES||!Array.isArray(p.unselectedHourBuckets))return false;
 const seen=new Set<string>(),occupied=new Set<number>();
 for(const [i,q] of p.points.entries()){
  if(!exact(q,['sourceRef','minute','condition','temperatureDeciC','relativeHumidityPermille'])||!sourceId(p.worldId,q.sourceRef)||seen.has(q.sourceRef)||!minute(q.minute)||q.minute<p.fromMinute||q.minute>p.throughMinute||q.sourceRef!==`${p.worldId}/weather-${p.permissionVersion}-${Math.floor(q.minute/60)}`||occupied.has(Math.floor(q.minute/60))||!option(CONDITIONS,q.condition)||!integer(q.temperatureDeciC,-300,450)||!integer(q.relativeHumidityPermille,0,1000)||(i>0&&byMinute(p.points[i-1],q)>=0))return false;
  seen.add(q.sourceRef);occupied.add(Math.floor(q.minute/60));
 }
 return serial(p.unselectedHourBuckets)===serial(unselectedBuckets(p.fromMinute,p.throughMinute,p.points));
}
/** Canonical read-only projection for the almanac editor and topic chooser.
 * Empty hour buckets mean "not represented in this packet", not an archive claim. */
export function createValleySpiritAlmanacPacket(range:ValleySpiritAlmanacRange,a:ValleySpiritAlmanacAuthority):ValleySpiritAlmanacPacket|null {
 try{
  if(!world(range.worldId)||!minute(range.fromMinute)||!minute(range.throughMinute)||range.throughMinute<range.fromMinute||Math.floor(range.throughMinute/60)-Math.floor(range.fromMinute/60)>=MAX_SOURCES||!Array.isArray(range.sourceRefs)||!range.sourceRefs.length||range.sourceRefs.length>MAX_SOURCES||new Set(range.sourceRefs).size!==range.sourceRefs.length||!range.sourceRefs.every(ref=>sourceId(range.worldId,ref)))return null;
  let version:number,records:readonly ValleySpiritAlmanacWeatherSource[];
  const readCurrent=a.readCurrent?.bind(a);
  if(readCurrent){
   const batch=readCurrent(range.sourceRefs);
   if(!batch||batch.worldId!==range.worldId||!Array.isArray(batch.records)||batch.records.length!==range.sourceRefs.length)return null;
   version=batch.permissionVersion;records=batch.records;
  }else{
   const permission=a.permission();if(!permission?.publicWeather)return null;
   const sources=range.sourceRefs.map(ref=>a.resolve(ref));
   if(sources.some(source=>source===null))return null;
   version=permission.version;records=sources as ValleySpiritAlmanacWeatherSource[];
   const check=a.permission();
   if(!check?.publicWeather||check.version!==version)return null;
  }
  const points:WeatherPoint[]=[];
  for(const [i,source] of records.entries()){
   const ref=range.sourceRefs[i];
   if(!source||source.sourceRef!==ref||source.permissionVersion!==version||source.fact.projectionVersion!==VERSION||source.fact.worldId!==range.worldId)return null;
   const f=source.fact;
   points.push({sourceRef:ref,minute:f.minute,condition:f.condition,temperatureDeciC:f.temperatureDeciC,relativeHumidityPermille:f.relativeHumidityPermille});
  }
  points.sort(byMinute);
  const p:ValleySpiritAlmanacPacket={schemaVersion:VERSION,projectionVersion:VERSION,permissionVersion:version,worldId:range.worldId,fromMinute:range.fromMinute,throughMinute:range.throughMinute,coverage:'selected-actual-points-only',unselectedHourBuckets:unselectedBuckets(range.fromMinute,range.throughMinute,points),points};
  return validPacket(p)?p:null;
 }catch{return null;}
}
function canonicalPacket(p:ValleySpiritAlmanacPacket):ValleySpiritAlmanacPacket {
 return {schemaVersion:VERSION,projectionVersion:VERSION,permissionVersion:p.permissionVersion,worldId:p.worldId,fromMinute:p.fromMinute,throughMinute:p.throughMinute,coverage:'selected-actual-points-only',unselectedHourBuckets:[...p.unselectedHourBuckets],points:p.points.map(q=>({sourceRef:q.sourceRef,minute:q.minute,condition:q.condition,temperatureDeciC:q.temperatureDeciC,relativeHumidityPermille:q.relativeHumidityPermille}))};
}
function permit(p:ValleySpiritAlmanacPacket,a:ValleySpiritAlmanacAuthority):boolean {
 const current=createValleySpiritAlmanacPacket({...p,sourceRefs:p.points.map(q=>q.sourceRef)},a);
 return !!current&&serial(current)===serial(canonicalPacket(p));
}
export function groundValleySpiritAlmanacDraft(packet:ValleySpiritAlmanacPacket,draft:unknown):GroundedDraft|null {
 if(!validPacket(packet)||!rec(draft)||!option(MOODS,draft.atmosphere))return null;
 const hasWording=Object.hasOwn(draft,'wording');
 if(hasWording?(!exact(draft,['claims','atmosphere','wording'])||!option(WORDINGS,draft.wording)):!exact(draft,['claims','atmosphere']))return null;
 if(!Array.isArray(draft.claims)||!draft.claims.length||draft.claims.length>MAX_CLAIMS)return null;
 const byRef=new Map(packet.points.map(q=>[q.sourceRef,q])),seen=new Set<string>(),claims:Claim[]=[];
 for(const c of draft.claims as unknown[]){
  if(!rec(c)||!exact(c,['sourceRef','field','value'])||!option(FIELDS,c.field))return null;
  if(typeof c.sourceRef!=='string')return null;
  const point=byRef.get(c.sourceRef),key=c.sourceRef+'\0'+c.field;
  if(!point||seen.has(key)||!Object.is(c.value,point[c.field]))return null;
  seen.add(key);claims.push({sourceRef:c.sourceRef,field:c.field,value:point[c.field]});
 }
 return {claims,atmosphere:draft.atmosphere,wording:option(WORDINGS,draft.wording)?draft.wording:'time-first'};
}
const rangeKey=(p:ValleySpiritAlmanacPacket)=>serial([p.worldId,p.fromMinute,p.throughMinute]);
function identity(p:ValleySpiritAlmanacPacket,textVersion:number,origin:ValleySpiritAlmanacOrigin):string {
 return 'valley-almanac-'+createHash('sha256').update(serial([rangeKey(p),textVersion,origin.schemaVersion,origin.kind])).digest('hex');
}
function validOrigin(value:unknown):value is ValleySpiritAlmanacOrigin {
 return rec(value)&&exact(value,['schemaVersion','kind'])&&value.schemaVersion===ORIGIN_SCHEMA&&option(KNOWN_ORIGINS,value.kind);
}
export function validateValleySpiritAlmanacEntries(value:unknown):value is ValleySpiritAlmanacEntry[] {
 if(!Array.isArray(value))return false;
 const seen=new Map<string,ValleySpiritAlmanacEntry>(),heads=new Map<string,ValleySpiritAlmanacEntry>();
 for(const e of value as ValleySpiritAlmanacEntry[]){
  if(!exact(e,['schemaVersion','entryId','textVersion','supersedes','packet','phase','draft','failure','rendered','origin'])||e.schemaVersion!==ALMANAC_ENTRY_SCHEMA||!validPacket(e.packet)||!option(phases,e.phase)||!integer(e.textVersion,1,10000)||!validOrigin(e.origin)||e.entryId!==identity(e.packet,e.textVersion,e.origin)||seen.has(e.entryId))return false;
  const k=rangeKey(e.packet),before=heads.get(k);
  if(e.textVersion===1?(e.supersedes!==null||!!before):(!before||e.supersedes!==before.entryId||before.textVersion+1!==e.textVersion||!['published','retracted'].includes(before.phase)))return false;
  const needsDraft=e.phase==='grounded'||e.phase==='published';
  const grounded=needsDraft?groundValleySpiritAlmanacDraft(e.packet,e.draft):null;
  if(needsDraft?(!grounded||!exact(e.draft,['claims','atmosphere','wording'])):e.draft!==null)return false;
  // Validate historical snapshots with the renderer for their stored version.
  // Never re-render in a public response; an unknown renderer is unavailable.
  if(e.phase==='published'){
   if(!grounded||e.rendered?.rendererVersion!==TEXT_RENDERER_VERSION||serial(e.rendered)!==serial(renderAlmanacTextV1(e.packet,grounded)))return false;
  }else if(e.rendered!==null)return false;
  if(e.phase==='retracted'?!option(['permission','source-correction'],e.failure):e.phase==='discarded'?!option(failures,e.failure):e.failure!==null)return false;
  seen.set(e.entryId,e);heads.set(k,e);
 }
 return true;
}
function frozenPacket(p:ValleySpiritAlmanacPacket):Readonly<ValleySpiritAlmanacPacket> {
 const copy=canonicalPacket(p);for(const point of copy.points)Object.freeze(point);Object.freeze(copy.points);Object.freeze(copy.unselectedHourBuckets);return Object.freeze(copy);
}
// Keep v1 frozen. A future copy edit is a new renderer and an explicit new
// publication/correction, not a retroactive change to already published text.
function renderAlmanacTextV1(p:ValleySpiritAlmanacPacket,draft:GroundedDraft):RenderedAlmanac {
 const byRef=new Map(p.points.map(q=>[q.sourceRef,q]));
 const chinese:Record<Condition,string>={sun:'晴',cloud:'阴',rain:'雨',snow:'雪',mixed:'雨雪混合'};
 const facts=draft.claims.map(c=>{
  const at=byRef.get(c.sourceRef)!.minute;
  const detail=c.field==='condition'?`天气：${chinese[c.value as Condition]}`:c.field==='temperatureDeciC'?`气温：${((c.value as number)/10).toFixed(1)}℃`:`相对湿度：${((c.value as number)/10).toFixed(1)}%`;
  const time=`第 ${at} 游戏分钟`;
  return {sourceRef:c.sourceRef,minute:at,field:c.field,value:c.value,text:draft.wording==='field-first'?`${detail}（${time}）`:`${time}，${detail}`};
 });
 return {rendererVersion:TEXT_RENDERER_VERSION,facts,atmosphere:{kind:'editorial-register-only',value:draft.atmosphere}};
}
function publicView(e:ValleySpiritAlmanacEntry) {
 if(e.phase!=='published'||!e.rendered)return null;
 const p=e.packet,r=structuredClone(e.rendered);
 return {mode:'curated-verified-weather' as const,origin:{...e.origin},entryId:e.entryId,textVersion:e.textVersion,supersedes:e.supersedes,fromMinute:p.fromMinute,throughMinute:p.throughMinute,projectionVersion:p.projectionVersion,permissionVersion:p.permissionVersion,coverage:p.coverage,unselectedHourBuckets:[...p.unselectedHourBuckets],facts:r.facts,atmosphere:r.atmosphere};
}
export class ValleySpiritAlmanac {
 constructor(private readonly store:ValleySpiritAlmanacStore,private readonly authority:ValleySpiritAlmanacAuthority){}
 private read():ValleySpiritAlmanacEntry[] {
  const rows=structuredClone(this.store.read());
  if(!validateValleySpiritAlmanacEntries(rows))throw Error('invalid_almanac_state');
  return rows;
 }
 private change(old:ValleySpiritAlmanacEntry[],entry:ValleySpiritAlmanacEntry):boolean {
  const i=old.findIndex(e=>e.entryId===entry.entryId);
  const updated=[...old];if(i<0)updated.push(entry);else updated[i]=entry;
  return validateValleySpiritAlmanacEntries(updated)&&this.store.replace(old,updated);
 }
 private transition(id:string,expect:Phase,next:Phase,draft:GroundedDraft|null=null,failure:Failure|null=null):boolean {
  const rows=this.read();const current=rows.find(e=>e.entryId===id);
  return !!current&&current.phase===expect&&this.change(rows,{...current,phase:next,draft,failure});
 }
 /** Current snapshots are rebuilt by ref before both debit/send and publishing.
  * An absent admission means default-off; do not make a staged request. */
 async generate(range:ValleySpiritAlmanacRange, admission?:ValleySpiritAlmanacAdmission, supersedes?:string):Promise<string|null> {
  if(!admission)return null;
  try{
   const packet=createValleySpiritAlmanacPacket(range,this.authority);if(!packet)return null;
   const origin=originOf(admission);
   const rows=this.read(),latest=rows.filter(e=>rangeKey(e.packet)===rangeKey(packet)).at(-1);
   const retry=latest?.phase==='discarded'&&latest.failure==='not-sent'&&latest.origin.kind===origin.kind&&latest.supersedes===(supersedes??null)&&serial(canonicalPacket(latest.packet))===serial(packet);
   if(!retry&&(latest?(supersedes!==latest.entryId||!['published','retracted'].includes(latest.phase)):supersedes!==undefined))return null;
   const textVersion=retry?latest.textVersion:(latest?.textVersion??0)+1,entryId=identity(packet,textVersion,origin);
   const entry:ValleySpiritAlmanacEntry={schemaVersion:ALMANAC_ENTRY_SCHEMA,entryId,textVersion,supersedes:supersedes??null,packet,phase:'dispatch-intent',draft:null,failure:null,rendered:null,origin};
   if(!this.change(rows,entry))return null;
   const reservation=await admission.reserve({purpose:'valley-spirit-almanac',requestId:entryId,packetBytes:Buffer.byteLength(serial(packet)),promptVersion:VERSION});
   if(!reservation){this.transition(entryId,'dispatch-intent','discarded',null,'not-sent');return null;}
   let started=false;
   try{
    if(!permit(packet,this.authority)){
     this.transition(entryId,'dispatch-intent','discarded',null,'permission');
     return null;
    }
    // From here on a restart must conservatively assume possible delivery.
    if(!this.transition(entryId,'dispatch-intent','sent-unknown'))return null;
    if(!permit(packet,this.authority)){
     this.transition(entryId,'sent-unknown','discarded',null,'permission');
     return null;
    }
    started=true;
    const response=await reservation.send(frozenPacket(packet),()=>permit(packet,this.authority));
    if(!permit(packet,this.authority)){
     this.transition(entryId,'sent-unknown','discarded',null,'permission');
     return null;
    }
    const grounded=groundValleySpiritAlmanacDraft(packet,response);
    if(!grounded){this.transition(entryId,'sent-unknown','discarded',null,'invalid-draft');return null;}
    return this.transition(entryId,'sent-unknown','grounded',grounded)?entryId:null;
   }finally{if(!started)reservation.cancelUnsent();}
  }catch{return null;} // durable intent or sent-unknown is never retried automatically
 }
 /** Internal scheduler recovery view, never an HTTP/export surface. */
 schedulingState(range:Pick<ValleySpiritAlmanacRange,'worldId'|'fromMinute'|'throughMinute'>):
  {status:'empty'|'unavailable'}|{status:'recorded';entryId:string;phase:Phase}{
  try{
   const head=this.read().filter(e=>e.packet.worldId===range.worldId&&e.packet.fromMinute===range.fromMinute&&e.packet.throughMinute===range.throughMinute).at(-1);
   return head?{status:'recorded',entryId:head.entryId,phase:head.phase}:{status:'empty'};
  }catch{return {status:'unavailable'};}
 }
 publish(entryId:string):boolean {
  try{
   const rows=this.read(),e=rows.find(e=>e.entryId===entryId);
   if(!e||e.phase!=='grounded')return false;
   if(!permit(e.packet,this.authority)){this.change(rows,{...e,phase:'discarded',draft:null,failure:'permission'});return false;}
   const draft=groundValleySpiritAlmanacDraft(e.packet,e.draft);if(!draft)return false;
   return this.change(rows,{...e,phase:'published',rendered:renderAlmanacTextV1(e.packet,draft)});
  }catch{return false;}
 }
 /** Retractions are visible in private provenance; revoked facts and links
  * remain hidden even when the sweep could not write. */
 retractChanged():number {
  try{
   const rows=this.read();
   const permission=this.authority.permission();let affected=0;
   const next:ValleySpiritAlmanacEntry[]=rows.map(e=>{
    if((e.phase!=='published'&&e.phase!=='grounded')||permit(e.packet,this.authority))return e;
    affected++;
    const failure=permission?.publicWeather&&permission.version===e.packet.permissionVersion?'source-correction' as const:'permission' as const;
    return {...e,phase:e.phase==='published'?'retracted':'discarded',draft:null,rendered:null,failure};
   });
   return affected&&validateValleySpiritAlmanacEntries(next)&&this.store.replace(rows,next)?affected:0;
  }catch{return 0;}
 }
 get(entryId:string){
  try {
   const rows=this.read(),e=rows.find(r=>r.entryId===entryId);
   if(!e||e.phase!=='published'||!permit(e.packet,this.authority)||rows.some(r=>rangeKey(e.packet)===rangeKey(r.packet)&&r.textVersion>e.textVersion&&(r.phase==='published'||r.phase==='retracted')))return null;
   // A correction must not disclose a previously revoked entry's ID.
   const publicEntry=e.supersedes&&rows.some(r=>r.entryId===e.supersedes&&r.phase==='published'&&permit(r.packet,this.authority))?e:{...e,supersedes:null};
   return publicView(publicEntry);
  }catch{return null;}
 }
 /** Public index never returns revoked, ungrounded, or superseded text. */
 latest(worldId:string,permissionVersion:number){
  try{
   const rows=this.read(),visibleHeads=new Map<string,ValleySpiritAlmanacEntry>();
   for(const entry of rows){
    if(entry.packet.worldId!==worldId||!['published','retracted'].includes(entry.phase))continue;
    visibleHeads.set(rangeKey(entry.packet),entry);
   }
   const ordered=[...visibleHeads.values()]
    .filter(entry=>entry.phase==='published'&&entry.packet.permissionVersion===permissionVersion)
    .sort((a,b)=>b.packet.throughMinute-a.packet.throughMinute||b.textVersion-a.textVersion||a.entryId.localeCompare(b.entryId));
   for(const entry of ordered.slice(0,24)){
    if(!permit(entry.packet,this.authority))continue;
    const previous=entry.supersedes?rows.find(row=>row.entryId===entry.supersedes):null;
    const mayLink=previous?.phase==='published'&&permit(previous.packet,this.authority);
    return publicView(mayLink?entry:{...entry,supersedes:null});
   }
   return null;
  }catch{return null;}
 }
 /** Explicit fallback must never masquerade as model narration. */
 objective(range:ValleySpiritAlmanacRange) {
  const packet=createValleySpiritAlmanacPacket(range,this.authority);
  return packet?{mode:'objective-weather-points' as const,generatedBy:'fixed-factual-template' as const,modelNarration:'unavailable' as const,packet}:null;
 }
}
