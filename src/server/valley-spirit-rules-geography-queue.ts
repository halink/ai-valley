import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,fsyncSync,lstatSync,openSync,readSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import type {Vec,World} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {inspectMvpGroundFruitGeography} from '../world/mvp-ground-fruit.js';
import type {ValleySpiritJournal} from './valley-spirit.js';
import {currentClosedRain} from './valley-spirit-persistent-rules-shadow.js';
import {nativeWeatherHourTransition} from './valley-spirit-weather-credit.js';
import {VALLEY_SPIRIT_GEOGRAPHY_ONLY_MENU,VALLEY_SPIRIT_GEOGRAPHY_ONLY_PIN,
 valleySpiritFruitFallOpportunityId} from './valley-spirit-proposal.js';

const unit=1_000_000,hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const bounded=(v:unknown,min:number,max:number)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
const schema='valley-spirit-rules-geographic-only-queue/v1',maxRows=64,maxBytes=128*1024,hourUs=60*unit;
const fields=['status','worldId','proposalId','opportunityId','atUs','untilUs','headRevision','permissionVersion',
 'rainEventId','sourceRef','sourceResourceInstanceId','targetId','inputSnapshotId','executionAuthorized'];
interface GeographyEntry {
 readonly status:'proposed';readonly worldId:string;readonly proposalId:string;readonly opportunityId:string;
 readonly atUs:number;readonly untilUs:number;readonly headRevision:number;readonly permissionVersion:number;
 readonly rainEventId:string;readonly sourceRef:string;readonly sourceResourceInstanceId:string;readonly targetId:string;
 readonly inputSnapshotId:string;readonly executionAuthorized:false;
}
const missing=(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='ENOENT';
function validEntry(v:unknown,worldId:string):v is GeographyEntry{
 if(!exact(v,fields)||v.status!=='proposed'||v.worldId!==worldId||v.executionAuthorized!==false||
  !bounded(v.atUs,hourUs,Number.MAX_SAFE_INTEGER)||Number(v.atUs)%hourUs!==0||
  !bounded(v.untilUs,Number(v.atUs)+1,Math.min(Number.MAX_SAFE_INTEGER,Number(v.atUs)+120*unit))||
  !bounded(v.headRevision,0,Number.MAX_SAFE_INTEGER)||!bounded(v.permissionVersion,1,Number.MAX_SAFE_INTEGER)||
  typeof v.sourceResourceInstanceId!=='string'||!/^mvp-fruit:[A-Za-z0-9:_-]{1,160}:\d+:\d+$/u.test(v.sourceResourceInstanceId)||
  typeof v.rainEventId!=='string'||!v.rainEventId.startsWith(worldId+':rain:')||!/^\d{1,16}$/u.test(v.rainEventId.slice(worldId.length+6))||
  typeof v.sourceRef!=='string'||!v.sourceRef.startsWith(worldId+'/weather-'+v.permissionVersion+'-')||
  !/^\d{1,16}$/u.test(v.sourceRef.slice((worldId+'/weather-'+v.permissionVersion+'-').length))||
  typeof v.targetId!=='string'||!/^ground:\d{1,4}:\d{1,4}$/u.test(v.targetId)||
  typeof v.inputSnapshotId!=='string'||!v.inputSnapshotId.startsWith(VALLEY_SPIRIT_GEOGRAPHY_ONLY_PIN)||
  !/^[a-f0-9]{64}$/u.test(v.inputSnapshotId.slice(VALLEY_SPIRIT_GEOGRAPHY_ONLY_PIN.length)))return false;
 const id=valleySpiritFruitFallOpportunityId(worldId,v.rainEventId,v.sourceResourceInstanceId);
 return v.opportunityId===id&&v.proposalId==='g1-geography:'+hash(id);
}
function readEntries(bytes:Buffer|null,worldId:string):GeographyEntry[]{
 if(!bytes)return [];
 const body:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!exact(body,['schema','worldId','entries'])||body.schema!==schema||body.worldId!==worldId||
  !Array.isArray(body.entries)||body.entries.length>maxRows||!body.entries.every(e=>validEntry(e,worldId))||
  body.entries.some((e,i,rows)=>i>0&&e.atUs<=rows[i-1].atUs)||
  new Set(body.entries.map(e=>e.opportunityId)).size!==body.entries.length||!bytes.equals(Buffer.from(JSON.stringify(body))))
  throw Error('rules_geographic_queue_unknown');
 return body.entries;
}
export interface RulesGeographyQueueOptions {
 readonly scope:'persistent-rules-geographic-queue/v1';readonly enabled:true;
 readonly worldId:string;readonly maxCandidates:number;readonly maxAgeGameMinutes:number;
 readonly site:{readonly sourceId:string;readonly target:Readonly<Vec>};
}
export function pinRulesGeographyQueue(input:unknown):RulesGeographyQueueOptions|null{
 try{
  const v:unknown=structuredClone(input);
  if(!exact(v,['scope','enabled','worldId','maxCandidates','maxAgeGameMinutes','site'])||
   v.scope!=='persistent-rules-geographic-queue/v1'||v.enabled!==true||
   typeof v.worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/u.test(v.worldId)||
   !bounded(v.maxCandidates,1,64)||!bounded(v.maxAgeGameMinutes,1,120)||
   !exact(v.site,['sourceId','target'])||typeof v.site.sourceId!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/u.test(v.site.sourceId)||
   !exact(v.site.target,['x','y'])||!bounded(v.site.target.x,0,4095)||!bounded(v.site.target.y,0,4095))return null;
  return v as unknown as RulesGeographyQueueOptions;
 }catch{return null;}
}
/** Sidecar only; no trigger or account capability. Call from the actual rules
 * owner after the normal committed hour and its current public archive sample. */
export function openRulesGeographyQueue(database:string,config:RulesGeographyQueueOptions,journal:Pick<ValleySpiritJournal,'currentObservedRainPacket'|'isCurrentPublicInput'>,
 assertOwned:()=>void,readCommittedWorld:()=>World|null){
 const privateFile=(path:string)=>{
  const f=lstatSync(path,{bigint:true});
  if(!f.isFile()||f.nlink!==1n||f.uid!==BigInt(process.getuid!())||(f.mode&0o077n)!==0n)
   throw Error('rules_geographic_queue_private_file_required');
  return f;
 };
 assertOwned();
 const identity=privateFile(database);
 const path=resolve(database)+'.valley-spirit-rules-geography-v1.json';
 const check=()=>{
  assertOwned();
  const f=privateFile(database);
  if(f.dev!==identity.dev||f.ino!==identity.ino)throw Error('rules_geographic_queue_database_changed');
 };
 const read=():Buffer|null=>{
  check();
  let stat:ReturnType<typeof privateFile>;
  try{stat=privateFile(path);}catch(e){if(missing(e))return null;throw e;}
  if(stat.size>BigInt(maxBytes))throw Error('rules_geographic_queue_too_large');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const opened=fstatSync(fd,{bigint:true});
   if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size||opened.uid!==stat.uid||
    opened.nlink!==1n||opened.mode!==stat.mode||opened.ctimeNs!==stat.ctimeNs)throw Error('rules_geographic_queue_replaced');
   const bytes=Buffer.allocUnsafe(Number(stat.size)+1);
   let count=0;
   while(count<bytes.length){
    const n=readSync(fd,bytes,count,bytes.length-count,count);
    if(n===0)break;
    count+=n;
   }
   const final=fstatSync(fd,{bigint:true});
   if(BigInt(count)!==stat.size||final.ctimeNs!==stat.ctimeNs)throw Error('rules_geographic_queue_changed');
   return bytes.subarray(0,count);
  }finally{closeSync(fd);}
 };
 let disk=read(),entries=readEntries(disk,config.worldId),isolated=false;
 const unchanged=()=>{
  const latest=read();
  return disk===null?latest===null:latest!==null&&disk.equals(latest);
 };
 const append=(entry:GeographyEntry)=>{
  if(isolated||entries.length>=config.maxCandidates||entries.some(e=>e.opportunityId===entry.opportunityId||e.atUs>=entry.atUs))return;
  let temp:string|undefined,fd:number|undefined;
  try{
   const bytes=Buffer.from(JSON.stringify({schema,worldId:config.worldId,entries:[...entries,entry]}));
   if(bytes.length>maxBytes)return;
   const next=readEntries(bytes,config.worldId);
   if(!unchanged())throw Error('rules_geographic_queue_changed');
   const tmp=path+'.'+randomUUID()+'.tmp';
   fd=openSync(tmp,constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_WRONLY,0o600);temp=tmp;
   writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;
   if(!unchanged())throw Error('rules_geographic_queue_changed');
   renameSync(tmp,path);temp=undefined;
   const parent=openSync(dirname(path),constants.O_DIRECTORY|constants.O_RDONLY);
   try{fsyncSync(parent);}finally{closeSync(parent);}
   disk=bytes;entries=next;
  }catch{isolated=true;}
  finally{
   if(fd!==undefined)try{closeSync(fd);}catch{/* preserve primary failure */}
   if(temp!==undefined)try{unlinkSync(temp);}catch{/* do not adopt partial files */}
  }
 };
 return (beforeMinute:number,committed:Readonly<{id:string;revision:number;minute:number}>)=>{
  try{
   if(committed.id!==config.worldId||!nativeWeatherHourTransition(beforeMinute,committed.minute))return;
   check();
   const world=readCommittedWorld();
   if(!world||world.id!==committed.id||world.revision!==committed.revision||world.minute!==committed.minute||world.clock.paused)return;
   const rain=currentClosedRain(world,config.maxAgeGameMinutes);
   if(!rain)return;
   const packet=journal.currentObservedRainPacket(BigInt(rain.firstRainUs),BigInt(rain.endedUs));
   if(!packet||packet.worldId!==world.id||packet.records.some(r=>r.fact.worldRevision>world.revision)||!journal.isCurrentPublicInput(packet))return;
   const geo=inspectMvpGroundFruitGeography(world,config.site.sourceId,config.site.target);
   if(!geo)return;
   const now=Number(minuteToClimateUs(world.minute)),until=Number(BigInt(rain.endedUs)+BigInt(config.maxAgeGameMinutes)*BigInt(unit));
   if(isolated||entries.length>=config.maxCandidates||until<=now||packet.sourceRefs.length!==1)return;
   // Stable across all permissions, coordinates/config revisions and restarts;
   // the input pin separately commits the actual current source and public fact.
   const opportunity=valleySpiritFruitFallOpportunityId(world.id,rain.rainEventId,geo.source.resourceInstanceId);
   const proposalId='g1-geography:'+hash(opportunity);
   const inputSnapshotId=VALLEY_SPIRIT_GEOGRAPHY_ONLY_PIN+hash([VALLEY_SPIRIT_GEOGRAPHY_ONLY_MENU,world.id,world.revision,now,until,rain,
    packet,config.site,geo,config.maxAgeGameMinutes]);
   if(journal.isCurrentPublicInput(packet))append({
    status:'proposed',worldId:world.id,proposalId,opportunityId:opportunity,atUs:now,untilUs:until,headRevision:world.revision,
    permissionVersion:packet.permissionVersion,rainEventId:rain.rainEventId,sourceRef:packet.sourceRefs[0],
    sourceResourceInstanceId:geo.source.resourceInstanceId,targetId:geo.targetId,inputSnapshotId,executionAuthorized:false,
   });
  }catch{/* Private G1 failure never propagates after a committed world minute. */}
 };
}
