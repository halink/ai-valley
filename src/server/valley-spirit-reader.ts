import {ValleySpiritAlmanac,type ValleySpiritAlmanacAuthority} from './valley-spirit-almanac.js';
import type {SqliteValleySpiritAlmanacReader} from './valley-spirit-almanac-store.js';
import {ValleySpiritAlmanacTopics} from './valley-spirit-topics.js';
import {parseWeatherArchiveQuery,type ValleySpiritJournal} from './valley-spirit.js';

const TOPIC_WINDOW=24;
export type ValleySpiritTopicWindow={fromHour:number;toHour:number};
const validWindow=(r:ValleySpiritTopicWindow)=>Number.isSafeInteger(r.fromHour)&&r.fromHour>=0&&Number.isSafeInteger(r.toHour)&&r.toHour>r.fromHour&&r.toHour-r.fromHour<=TOPIC_WINDOW;
export function parseValleySpiritTopicWindow(params:URLSearchParams):ValleySpiritTopicWindow|null {
 if([...params.keys()].length!==2||!params.has('fromHour')||!params.has('toHour'))return null;
 const range=parseWeatherArchiveQuery(params);
 return range&&'fromHour' in range&&validWindow(range)?{fromHour:range.fromHour,toHour:range.toHour}:null;
}
export function parseValleySpiritAlmanacId(params:URLSearchParams):string|null {
 if([...params.keys()].length!==1)return null;
 const id=params.get('entryId');
 return id&&/^valley-almanac-[a-f0-9]{64}$/.test(id)?id:null;
}
type JournalReader=Pick<ValleySpiritJournal,'publicWeatherPermission'|'resolveSource'|'publicNarrationInput'|'archive'>;
export interface ValleySpiritPublicReaders {
 almanac(entryId:string):ReturnType<ValleySpiritAlmanac['get']>;
 latestAlmanac():
  {status:'ready';worldId:string;permissionVersion:number;entry:NonNullable<ReturnType<ValleySpiritAlmanac['get']>>}|
  {status:'objective-only';worldId:string;permissionVersion:number}|{status:'unavailable'};
 topics(range:ValleySpiritTopicWindow):
  {status:'ready';mode:'read-only-observed-topics';menu:ReturnType<ValleySpiritAlmanacTopics['preview']>}|
  {status:'invalid'|'unavailable'};
}
/** Intentionally has no transport, generation, store/write or scheduling seam. */
export function createValleySpiritPublicReaders(journal:JournalReader,reader?:Pick<SqliteValleySpiritAlmanacReader,'read'>&Partial<Pick<SqliteValleySpiritAlmanacReader,'matchesReviewedSources'>>):ValleySpiritPublicReaders {
 const authority:ValleySpiritAlmanacAuthority={
  permission:()=>journal.publicWeatherPermission(),
  resolve:ref=>journal.resolveSource(ref),
  readCurrent:refs=>journal.publicNarrationInput(refs),
  matchesReviewedSources:entry=>{
   const current=journal.publicNarrationInput(entry.packet.points.map(p=>p.sourceRef));
   return !!current&&current.worldId===entry.packet.worldId&&current.permissionVersion===entry.packet.permissionVersion&&
    reader?.matchesReviewedSources?.(entry,current.records)===true;
  },
 };
 const almanac=reader?new ValleySpiritAlmanac({read:()=>reader.read(),replace:()=>false},authority):null;
 const topics=new ValleySpiritAlmanacTopics(authority);
 return {
  almanac:id=>almanac?.get(id)??null,
  latestAlmanac:()=>{
   const observed=journal.publicNarrationInput();
   if(!observed)return {status:'unavailable'};
   const {worldId,permissionVersion}=observed;
   const entry=almanac?.latest(worldId,permissionVersion);
   const current=journal.publicWeatherPermission();
   if(!current?.publicWeather||current.version!==permissionVersion)return {status:'unavailable'};
   return entry?{status:'ready',worldId,permissionVersion,entry}:{status:'objective-only',worldId,permissionVersion};
  },
  topics:range=>{
   if(!validWindow(range))return {status:'invalid'};
   const archived=journal.archive({...range,limit:TOPIC_WINDOW});
   if(archived.status!=='ready')return {status:archived.status};
   const records=archived.slots.flatMap(s=>s.status==='observed'?[s.record]:[]);
   if(!records.length)return {status:'ready',mode:'read-only-observed-topics',menu:null};
   const fromMinute=archived.coverage.fromHour*60;
   // Packet endpoints are inclusive; archive end is exclusive. Include any
   // observed fractional-minute point very close to the boundary as well.
   const throughMinute=Math.max(archived.coverage.toHour*60-0.000001,...records.map(e=>e.fact.minute));
   const menu=topics.preview({worldId:archived.worldId,fromMinute,throughMinute,sourceRefs:records.map(e=>e.sourceRef)});
   return menu&&menu.permissionVersion===archived.permissionVersion?{status:'ready',mode:'read-only-observed-topics',menu}:{status:'unavailable'};
  },
 };
}
