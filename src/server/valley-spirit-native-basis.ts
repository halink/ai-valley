import {DatabaseSync} from 'node:sqlite';
import {acquireRuntimeOwnership} from './runtime-lock.js';
import {decodeSavedWorld} from './save-preflight.js';
import {ValleySpiritAlmanac} from './valley-spirit-almanac.js';
import {SqliteValleySpiritAlmanacReader,readValleySpiritAlmanacSnapshot} from './valley-spirit-almanac-store.js';
import {SqliteValleySpiritPermissions,readValleySpiritWeatherPermission} from './valley-spirit-permissions.js';
import {publicWeatherProjection,readExistingPublicWeatherJournal,type PublicWeatherEntry} from './valley-spirit.js';
import {SqliteValleySpiritLifeReader,valleySpiritLifeAuthorityOnConnection} from './valley-spirit-life-authority.js';
import {ValleySpiritLifeViewer,valleySpiritLifeViewOnConnection} from './valley-spirit-life-publisher.js';
import {verifyValleySpiritSpeechCustody} from './valley-spirit-speech-custody.js';
import type {OfflineYearbookBasis} from './valley-spirit-yearbook-editor.js';
import {verifiesNativeWeatherCredit} from './valley-spirit-weather-credit.js';
import type {World} from '../shared/types.js';


type NativePin={worldId:string;weatherEntryId:string;lifeSectionId:string};
function checkedPin(options:NativePin){
 const pin=Object.freeze({...options});
 if(!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(pin.worldId)||!/^valley-almanac-[a-f0-9]{64}$/.test(pin.weatherEntryId)||!/^valley-life-section-[a-f0-9]{64}$/.test(pin.lifeSectionId))throw Error('native_yearbook_pin_invalid');
 return pin;
}
function readWorldHead(db:DatabaseSync,worldId:string){
   const rows=db.prepare('SELECT id,revision,state FROM worlds LIMIT 2').all();
   if(rows.length!==1||rows[0].id!==worldId)return null;
   const w=decodeSavedWorld(rows[0].state) as unknown as World;
   if(w.id!==worldId||w.revision!==rows[0].revision||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||Object.hasOwn(w,'mvpSeasonalModelVersion'))return null;
   return publicWeatherProjection(w);
}
/** Internal standalone inspection, not the ordinary runtime; shares ONE real
 * cooperative lifetime ownership lock across all pre-existing holders. JSON
 * and distinct SQLite reads are not a transaction or cross-restart proof. */
export function openPrivateNativeYearbookBasis(database:string,options:NativePin){
 const pin=checkedPin(options);

 const owner=acquireRuntimeOwnership(database);
 const handles:{close:()=>void}[]=[];
 let closed=false;
 const close=()=>{if(closed)return;closed=true;const failures:unknown[]=[];
  try{for(const h of handles.reverse())try{h.close();}catch(error){failures.push(error);}}finally{owner.release();}
  if(failures.length)throw new AggregateError(failures,'native_yearbook_close_failed');
 };
 try{
  const db=new DatabaseSync(owner.database,{readOnly:true});handles.push(db);
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
  const head=()=>{
   owner.assertOwned();
   return readWorldHead(db,pin.worldId);
  };
  if(!head())throw Error('native_yearbook_world_invalid');
  const perm=new SqliteValleySpiritPermissions(owner.database,pin.worldId,owner.assertOwned,true);handles.push(perm);
  const wc=new SqliteValleySpiritAlmanacReader(owner.database,pin.worldId,owner.assertOwned);handles.push(wc);
  const lifeReader=new SqliteValleySpiritLifeReader(owner.database,pin.worldId,owner.assertOwned,()=>{
   const h=head();return h?{worldId:h.worldId,asOfUs:h.atUs}:null;
  },receipt=>receipt.kind==='conversation-completed'&&verifyValleySpiritSpeechCustody(db,receipt));handles.push(lifeReader);
  const life=new ValleySpiritLifeViewer({mode:'offline-synthetic-life-publication',database:owner.database,worldId:pin.worldId,assertOwned:owner.assertOwned,authority:lifeReader});handles.push(life);
  let seen:PublicWeatherEntry[]=[];
  let seenEpoch=0,seenRevision=-1,seenTime=-1n,isolated=false;
  const capture=()=>{
   const h=head(),g=perm.read();
   if(!h||!g)return null;
   if(h.worldRevision<seenRevision||g.version<seenEpoch||BigInt(h.atUs)<seenTime){isolated=true;return null;}
   seenRevision=h.worldRevision;seenEpoch=g.version;seenTime=BigInt(h.atUs);
   const json=readExistingPublicWeatherJournal(owner.database,h,g);
   if(!json)return null;
   if(json.entries.length<seen.length||seen.some((e,i)=>JSON.stringify(e)!==JSON.stringify(json.entries[i]))){
    isolated=true;return null;
   }
   seen=json.entries;
   const refs=new Map(seen.filter(e=>e.permissionVersion===g.version).map(e=>[e.sourceRef,e]));
   const weather=new ValleySpiritAlmanac({read:()=>wc.read(),replace:()=>false},{
    permission:()=>g,resolve:r=>refs.get(r)??null,
   }).get(pin.weatherEntryId);
   const section=life.latest(pin.worldId);
   if(!weather||section?.sectionId!==pin.lifeSectionId||section.lines.some(l=>l.kind!=='conversation-completed'))return null;
   const marks={headUs:h.atUs,headRevision:h.worldRevision};
   const basis:OfflineYearbookBasis={worldId:pin.worldId,...marks,weather:{...marks,entryId:weather.entryId,textVersion:weather.textVersion,permissionVersion:weather.permissionVersion,
    facts:weather.facts.map(({sourceRef,minute,field,value})=>({sourceRef,minute,field,value}))},
    life:{...marks,sectionId:section.sectionId,lines:section.lines.map(({sourceRef,atUs,grantVersion,receiptVersion})=>({sourceRef,atUs,grantVersion,receiptVersion,kind:'conversation-completed'}))}};
   return {basis,raw:json.raw};
  };
  const read=()=>{
   if(closed||isolated)return null;
   try{
    const first=capture(),second=first&&capture();
    if(!first||!second||first.raw!==second.raw||JSON.stringify(first.basis)!==JSON.stringify(second.basis))return null;
    const b=second.basis;
    b.weather.facts.forEach(Object.freeze);b.life.lines.forEach(Object.freeze);
    Object.freeze(b.weather.facts);Object.freeze(b.life.lines);Object.freeze(b.weather);Object.freeze(b.life);
    return Object.freeze(b);
   }catch{isolated=true;return null;}
  };
  return Object.freeze({read,close});
 }catch(error){close();throw error;}
}

/** Strict private inspection only. The JSON is an untrusted candidate payload,
 * never an authority. Every referenced sample must have exact SQLite custody
 * in the same snapshot as both current grants, world head and publication logs. */
export function openPrivateAtomicNativeYearbookBasis(database:string,options:NativePin){
 const pin=checkedPin(options),owner=acquireRuntimeOwnership(database);
 let db:DatabaseSync|undefined;
 try{
  const sqlite=db=new DatabaseSync(owner.database,{readOnly:true});
  sqlite.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
  let closed=false,invalid=false,head:ReturnType<typeof readWorldHead>=null;
  let priorRevision=-1,priorTime=-1n,priorEpoch=0;
  let priorEntries:PublicWeatherEntry[]=[];
  const authority=valleySpiritLifeAuthorityOnConnection(sqlite,pin.worldId,owner.assertOwned,
   ()=>head?{worldId:head.worldId,asOfUs:head.atUs}:null,
   receipt=>receipt.kind==='conversation-completed'&&verifyValleySpiritSpeechCustody(sqlite,receipt));
  const latestLife=valleySpiritLifeViewOnConnection(sqlite,pin.worldId,owner.assertOwned,authority);
  const capture=():OfflineYearbookBasis|null=>{
   const h=head=readWorldHead(sqlite,pin.worldId);
   const grant=readValleySpiritWeatherPermission(sqlite,pin.worldId);
   if(!h||!grant)return null;
   if(h.worldRevision<priorRevision||BigInt(h.atUs)<priorTime||grant.version<priorEpoch)
    throw Error('rewound_native_yearbook_snapshot');
   priorRevision=h.worldRevision;priorTime=BigInt(h.atUs);priorEpoch=grant.version;
   const payload=readExistingPublicWeatherJournal(owner.database,h,grant);
   if(!payload)return null;
   if(payload.entries.length<priorEntries.length||priorEntries.some((row,i)=>JSON.stringify(row)!==JSON.stringify(payload.entries[i])))
    throw Error('rewound_native_yearbook_payload');
   const candidates=new Map(payload.entries.filter(e=>e.permissionVersion===grant.version).map(e=>[e.sourceRef,e]));
   const verified=new Map<string,PublicWeatherEntry|null>();
   const rows=readValleySpiritAlmanacSnapshot(sqlite,pin.worldId);
   const weather=new ValleySpiritAlmanac({read:()=>rows,replace:()=>false},{
    permission:()=>grant,resolve:ref=>{
     if(verified.has(ref))return verified.get(ref)??null;
     const entry=candidates.get(ref);
     const result=entry&&verifiesNativeWeatherCredit(sqlite,ref,entry.fact)?entry:null;
     verified.set(ref,result);return result;
    }
   }).get(pin.weatherEntryId);
   // Advance life histories whenever its current release can be checked, even
   // if no matching weather edition survives current validation.
   const life=latestLife(pin.worldId);
   if(!weather||life?.sectionId!==pin.lifeSectionId||life.lines.some(l=>l.kind!=='conversation-completed'))return null;
   priorEntries=payload.entries;
   const marks={headUs:h.atUs,headRevision:h.worldRevision};
   return {worldId:pin.worldId,...marks,weather:{...marks,entryId:weather.entryId,textVersion:weather.textVersion,
    permissionVersion:weather.permissionVersion,facts:weather.facts.map(({sourceRef,minute,field,value})=>Object.freeze({sourceRef,minute,field,value}))},
    life:{...marks,sectionId:life.sectionId,lines:life.lines.map(({sourceRef,atUs,grantVersion,receiptVersion})=>
     Object.freeze({sourceRef,atUs,grantVersion,receiptVersion,kind:'conversation-completed'}))}};
  };
  return Object.freeze({
   read():Readonly<OfflineYearbookBasis>|null{
    if(closed||invalid)return null;
    let transaction=false;
    try{
     owner.assertOwned();
     sqlite.exec('BEGIN');transaction=true;
     const b=capture();
     owner.assertOwned();
     sqlite.exec('COMMIT');transaction=false;
     if(!b)return null;
     Object.freeze(b.weather.facts);Object.freeze(b.life.lines);Object.freeze(b.weather);Object.freeze(b.life);
     return Object.freeze(b);
    }catch{
     invalid=true;
     if(transaction)try{sqlite.exec('ROLLBACK');}catch{/* no further reads */}
     return null;
    }finally{head=null;}
   },
   close(){
    if(closed)return;closed=true;
    try{sqlite.close();}finally{owner.release();}
   }
  });
 }catch(error){try{db?.close();}finally{owner.release();}throw error;}
}
