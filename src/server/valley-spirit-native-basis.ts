import {DatabaseSync} from 'node:sqlite';
import {acquireRuntimeOwnership} from './runtime-lock.js';
import {decodeSavedWorld} from './save-preflight.js';
import {ValleySpiritAlmanac} from './valley-spirit-almanac.js';
import {SqliteValleySpiritAlmanacReader} from './valley-spirit-almanac-store.js';
import {SqliteValleySpiritPermissions} from './valley-spirit-permissions.js';
import {publicWeatherProjection,readExistingPublicWeatherJournal,type PublicWeatherEntry} from './valley-spirit.js';
import {SqliteValleySpiritLifeReader} from './valley-spirit-life-authority.js';
import {ValleySpiritLifeViewer} from './valley-spirit-life-publisher.js';
import {verifyValleySpiritSpeechCustody} from './valley-spirit-speech-custody.js';
import type {OfflineYearbookBasis} from './valley-spirit-yearbook-editor.js';
import type {World} from '../shared/types.js';

/** Internal standalone inspection, not the ordinary runtime; shares ONE real
 * cooperative lifetime ownership lock across all pre-existing holders. JSON
 * and distinct SQLite reads are not a transaction or cross-restart proof. */
export function openPrivateNativeYearbookBasis(database:string,options:{worldId:string;weatherEntryId:string;lifeSectionId:string}){
 const pin=Object.freeze({...options});
 if(!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(pin.worldId)||!/^valley-almanac-[a-f0-9]{64}$/.test(pin.weatherEntryId)||!/^valley-life-section-[a-f0-9]{64}$/.test(pin.lifeSectionId))throw Error('native_yearbook_pin_invalid');
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
   const rows=db.prepare('SELECT id,revision,state FROM worlds LIMIT 2').all();
   if(rows.length!==1||rows[0].id!==pin.worldId)return null;
   const w=decodeSavedWorld(rows[0].state) as unknown as World;
   if(w.id!==pin.worldId||w.revision!==rows[0].revision||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||Object.hasOwn(w,'mvpSeasonalModelVersion'))return null;
   return publicWeatherProjection(w);
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
