import type {ValleySpiritPermissionAuthority} from './valley-spirit-permissions.js';
import {constants,closeSync,fsyncSync,fstatSync,lstatSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {World} from '../shared/types.js';
import {calendar} from '../world/time.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';

/** The only information crossing the ValleySpirit seam. No World, people,
 * events, seed, private dialogue, intent or knowledge enters the journal. */
export interface PublicWeatherFact {
 projectionVersion:1;worldId:string;worldRevision:number;minute:number;atUs:string;
 condition:'sun'|'cloud'|'rain'|'snow'|'mixed';temperatureDeciC:number;
 relativeHumidityPermille:number;cloudPermille:number;windPermille:number;
 daylightPermille:number;precipitationPermille:number;
}
interface Entry {entryId:string;sourceRef:string;permissionVersion:number;fromMinute:number;toMinute:number;fact:PublicWeatherFact;text:string;}
interface Journal {schemaVersion:1;worldId:string;permission:{version:number;publicWeather:boolean};entries:Entry[];}
const LIMIT=16*1024*1024;
const keys=['projectionVersion','worldId','worldRevision','minute','atUs','condition','temperatureDeciC','relativeHumidityPermille','cloudPermille','windPermille','daylightPermille','precipitationPermille'];
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,k:string[])=>record(v)&&Object.keys(v).length===k.length&&k.every(key=>Object.hasOwn(v,key));
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function validFact(v:unknown):v is PublicWeatherFact {
 if(!exact(v,keys))return false;const f=v as PublicWeatherFact;
 if(f.projectionVersion!==1||typeof f.worldId!=='string'||!f.worldId.startsWith('godot-mvp-')||f.worldId.length>200||!integer(f.worldRevision)||!Number.isFinite(f.minute)||f.minute<0||f.minute>1e9||typeof f.atUs!=='string'||f.atUs!==minuteToClimateUs(f.minute)||!['sun','cloud','rain','snow','mixed'].includes(f.condition)||!Number.isInteger(f.temperatureDeciC)||f.temperatureDeciC< -300||f.temperatureDeciC>450)return false;
 return ['relativeHumidityPermille','cloudPermille','windPermille','daylightPermille','precipitationPermille'].every(k=>{const n=f[k as keyof PublicWeatherFact];return typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<=1000;});
}
/** Trusted adapter reads only public climate fields from a committed world. */
export function publicWeatherProjection(w:World):PublicWeatherFact|null {
 try{if(w.simulationOnly||w.mode!=='validation'||!w.mvpClimate||![1,2,3].includes(w.mvpClimate.schemaVersion)||w.mvpClimate.algorithmVersion!==1||w.mvpClimate.lastMinute!==w.minute)return null;
 const p=w.mvpClimate.current;if(p.schemaVersion!==w.mvpClimate.schemaVersion||p.algorithmVersion!==1)return null;
 const f:PublicWeatherFact={projectionVersion:1,worldId:w.id,worldRevision:w.revision,minute:w.minute,atUs:p.atUs,condition:p.condition,temperatureDeciC:p.temperatureDeciC,relativeHumidityPermille:p.relativeHumidityPermille,cloudPermille:p.cloudPermille,windPermille:p.windPermille,daylightPermille:p.daylightPermille,precipitationPermille:p.precipitationPermille};
 return validFact(f)?f:null;}catch{return null;}
}
const seasons={spring:'春',summer:'夏',autumn:'秋',winter:'冬'};
const weather={sun:'晴',cloud:'阴',rain:'雨',snow:'雪',mixed:'雨雪混合'};
function describe(f:PublicWeatherFact):string {const c=calendar(f.minute);return `第${c.year}年${seasons[c.season]}季第${c.day}日 ${String(c.hour).padStart(2,'0')}:${String(c.minute).padStart(2,'0')}，此时${weather[f.condition]}，气温${(f.temperatureDeciC/10).toFixed(1)}℃、相对湿度${(f.relativeHumidityPermille/10).toFixed(1)}%。这是一个实际时点记录，不代表整日天气。`;}
function entryId(f:PublicWeatherFact,version:number){return `weather-${version}-${Math.floor(f.minute/60)}`;}
function validJournal(v:unknown,head:PublicWeatherFact):v is Journal {
 if(!exact(v,['schemaVersion','worldId','permission','entries']))return false;const j=v as Journal;
 if(j.schemaVersion!==1||j.worldId!==head.worldId||!exact(j.permission,['version','publicWeather'])||!integer(j.permission.version)||j.permission.version<1||typeof j.permission.publicWeather!=='boolean'||!Array.isArray(j.entries))return false;
 let minute=-1,revision=-1,permission=0;const ids=new Set<string>();
 for(const e of j.entries){if(!exact(e,['entryId','sourceRef','permissionVersion','fromMinute','toMinute','fact','text'])||!validFact(e.fact)||e.fact.worldId!==head.worldId||e.fact.minute>head.minute||e.fact.worldRevision>head.worldRevision||e.fact.minute<minute||e.fact.worldRevision<revision||!integer(e.permissionVersion)||e.permissionVersion<1||e.permissionVersion<permission||e.permissionVersion>j.permission.version||e.entryId!==entryId(e.fact,e.permissionVersion)||ids.has(e.entryId)||e.sourceRef!==`${j.worldId}/${e.entryId}`||e.fromMinute!==e.fact.minute||e.toMinute!==e.fact.minute||e.text!==describe(e.fact))return false;ids.add(e.entryId);minute=e.fact.minute;revision=e.fact.worldRevision;permission=e.permissionVersion;}
 return true;
}
export const valleySpiritUnavailable=()=>({schemaVersion:1 as const,status:'unavailable' as const,mode:'objective-weather-records' as const,generatedBy:'fixed-factual-template' as const,modelNarration:'disabled-pending-shared-admission-and-request-recovery' as const,records:[] as Entry[]});
/** Caller owns the existing world runtime lock for this complete lifetime.
 * Independent failures isolate this module, never roll back/stop the world.
 * The adjacent file is private persistence, not a public static/export route. */
export class ValleySpiritJournal {
 private state:Journal|undefined;
 private isolated=false;
 private diskText:string|null=null;
 private head:PublicWeatherFact;
 private readonly path:string;
 constructor(database:string,head:PublicWeatherFact,private readonly assertOwned:()=>void,private readonly permissions:ValleySpiritPermissionAuthority){
  this.path=resolve(database)+'.valley-spirit.json';this.head=structuredClone(head);
  try{if(!validFact(head))throw Error('invalid_public_fact');assertOwned();const text=this.read(),authority=permissions.read();if(text===null){if(authority)throw Error('initialized_journal_missing');this.state={schemaVersion:1,worldId:head.worldId,permission:permissions.initialize(),entries:[]};}else{const parsed:unknown=JSON.parse(text);if(!authority||!validJournal(parsed,head)||parsed.permission.version!==authority.version||parsed.permission.publicWeather!==authority.publicWeather)throw Error('incompatible_journal');this.state=parsed;}this.diskText=text;}catch{this.isolated=true;}
 }
 isolate():void {this.isolated=true;}
 private read():string|null {
  let stat;try{stat=lstatSync(this.path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>LIMIT)throw Error('unsafe_journal_path');
  const fd=openSync(this.path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const opened=fstatSync(fd);if(opened.ino!==stat.ino||opened.dev!==stat.dev||opened.size>LIMIT)throw Error('journal_changed');const bytes=readFileSync(fd);if(bytes.length>LIMIT)throw Error('journal_too_large');return bytes.toString('utf8');}finally{closeSync(fd);}
 }
 private current():Journal|null {
  if(this.isolated||!this.state)return null;
  try{this.assertOwned();if(this.read()!==this.diskText)throw Error('external_journal_change');const authority=this.permissions.read();if(!authority||authority.version!==this.state.permission.version||authority.publicWeather!==this.state.permission.publicWeather)throw Error('stale_journal_permission');return this.state;}catch{this.isolated=true;return null;}
 }
 private save(next:Journal):boolean {
  let temporary:string|undefined,fd:number|undefined;
  try{this.assertOwned();const authority=this.permissions.read();if(this.isolated||!authority||authority.version!==next.permission.version||authority.publicWeather!==next.permission.publicWeather||this.read()!==this.diskText||!validJournal(next,this.head))throw Error('journal_not_writable');const text=JSON.stringify(next);if(Buffer.byteLength(text)>LIMIT)throw Error('journal_full');temporary=this.path+'.'+randomUUID()+'.tmp';fd=openSync(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);writeFileSync(fd,text);fsyncSync(fd);closeSync(fd);fd=undefined;
   this.assertOwned();if(this.read()!==this.diskText)throw Error('journal_changed');renameSync(temporary,this.path);temporary=undefined;const dir=openSync(dirname(this.path),constants.O_RDONLY);try{fsyncSync(dir);}finally{closeSync(dir);}this.diskText=text;this.state=next;return true;
  }catch{this.isolated=true;return false;}finally{if(fd!==undefined)closeSync(fd);if(temporary)try{unlinkSync(temporary);}catch{/* a failed private temporary is never used as a journal */}}
 }
 /** Called only after authoritative world commit succeeds. No catch-up or guessed gaps. */
 observe(fact:PublicWeatherFact|null):void {
  try{const s=this.current();if(!s)return;if(!validFact(fact)||fact.worldId!==this.head.worldId||fact.minute<this.head.minute||fact.worldRevision<this.head.worldRevision)throw Error('invalid_committed_public_fact');this.head=structuredClone(fact);
   if(!s.permission.publicWeather)return;const id=entryId(fact,s.permission.version);if(s.entries.some(e=>e.entryId===id))return;
   const next=structuredClone(s);next.entries.push({entryId:id,sourceRef:`${s.worldId}/${id}`,permissionVersion:s.permission.version,fromMinute:fact.minute,toMinute:fact.minute,fact:structuredClone(fact),text:describe(fact)});this.save(next);
  }catch{this.isolated=true;}
 }
 /** Internal administrator seam only. Never exposed as a public HTTP mutation.
  * Re-enabling uses a NEW version; revoked history is not resurrected. */
 setPublicWeatherAllowed(allowed:boolean):boolean {
  const s=this.current();if(!s||typeof allowed!=='boolean')return false;if(s.permission.publicWeather===allowed)return true;
  const next=structuredClone(s);next.permission={version:s.permission.version+1,publicWeather:allowed};try{this.permissions.advance(s.permission,next.permission);}catch{this.isolated=true;return false;}return this.save(next);
 }
 view(){const s=this.current();const base=valleySpiritUnavailable();if(!s)return {...base,status:'isolated' as const};return {...base,status:s.permission.publicWeather?'ready' as const:'revoked' as const,worldId:s.worldId,atMinute:this.head.minute,worldRevision:this.head.worldRevision,permissionVersion:s.permission.version,persistent:this.diskText!==null,records:s.permission.publicWeather?structuredClone(s.entries.filter(e=>e.permissionVersion===s.permission.version).slice(-6).reverse()):[]};}
 /** All source lookups and future narrative input exports share the current gate. */
 resolveSource(sourceRef:string){const s=this.current();if(!s?.permission.publicWeather)return null;const e=s.entries.find(e=>e.sourceRef===sourceRef&&e.permissionVersion===s.permission.version);return e?structuredClone(e):null;}
 publicNarrationInput(){const view=this.view();if(view.status!=='ready')return null;return {mode:'public-weather-only' as const,worldId:view.worldId,projectionVersion:1 as const,permissionVersion:view.permissionVersion,sourceRefs:view.records.map(e=>e.sourceRef),records:structuredClone(view.records),dispatch:'disabled' as const};}
 /** Revalidation is mandatory before any future dispatch/publication. This does
  * not authorize an LLM call or provide an account/budget capability. */
 isCurrentPublicInput(input:ReturnType<ValleySpiritJournal['publicNarrationInput']>):boolean {const s=this.current();return !!s&&s.permission.publicWeather&&!!input&&exact(input,['mode','worldId','projectionVersion','permissionVersion','sourceRefs','records','dispatch'])&&input.mode==='public-weather-only'&&input.projectionVersion===1&&input.dispatch==='disabled'&&input.worldId===s.worldId&&input.permissionVersion===s.permission.version&&Array.isArray(input.sourceRefs)&&Array.isArray(input.records)&&input.sourceRefs.length===input.records.length&&new Set(input.sourceRefs).size===input.sourceRefs.length&&input.sourceRefs.every((ref,i)=>{const source=this.resolveSource(ref);return source!==null&&JSON.stringify(source)===JSON.stringify(input.records[i]);});}
}
