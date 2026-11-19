import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {isDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';
import {validateValleySpiritAlmanacEntries,type ValleySpiritAlmanacEntry,type ValleySpiritAlmanacStore} from './valley-spirit-almanac.js';
import type {DisconnectedWeatherUseContext} from './valley-spirit-weather-use-grant.js';

const TABLE='valley_spirit_private_weather_rehearsal';
const DDL=`CREATE TABLE ${TABLE}(slot INTEGER NOT NULL PRIMARY KEY, version INTEGER NOT NULL, scope TEXT NOT NULL, state TEXT NOT NULL)`;
const ROWS=32,BYTES=512*1024;
const attached=new WeakSet<DeveloperMvpSpiritFixtureOwner>();
const serial=(v:unknown)=>JSON.stringify(v);
function valid(rows:unknown,worldId:string):rows is ValleySpiritAlmanacEntry[]{
 return Array.isArray(rows)&&rows.length<=ROWS&&validateValleySpiritAlmanacEntries(rows)&&
  rows.every(e=>e.packet.worldId===worldId&&e.origin.kind==='offline-synthetic'&&
   (e.phase==='dispatch-intent'||e.phase==='sent-unknown'||e.phase==='grounded'||e.phase==='discarded'));
}
const intent=(e:ValleySpiritAlmanacEntry)=>serial([e.entryId,e.schemaVersion,e.textVersion,e.supersedes,e.packet,e.origin]);
function progresses(old:readonly ValleySpiritAlmanacEntry[],next:readonly ValleySpiritAlmanacEntry[]):boolean{
 if(next.length===old.length+1)return next.at(-1)?.phase==='dispatch-intent'&&old.every((e,i)=>serial(e)===serial(next[i]));
 if(next.length!==old.length)return false;
 let changed=0;
 for(const [i,a] of old.entries()){
  const b=next[i];
  if(serial(a)===serial(b))continue;
  if(++changed!==1||intent(a)!==intent(b))return false;
  if(a.phase==='dispatch-intent'&&(b.phase==='sent-unknown'||b.phase==='discarded')||
     a.phase==='sent-unknown'&&(b.phase==='grounded'||b.phase==='discarded')||
     a.phase==='discarded'&&a.failure==='not-sent'&&b.phase==='dispatch-intent')continue;
  return false;
 }
 return changed===1;
}

export function privateWeatherRehearsalScope(owner:DeveloperMvpSpiritFixtureOwner,context:DisconnectedWeatherUseContext){
 if(!isDeveloperMvpSpiritFixtureOwner(owner)||!owner.weatherUse||
    context.accountFingerprint!==owner.weatherUse.accountFingerprint||
    context.fixtureScopeId!==createHash('sha256').update('disconnected-weather-fixture/v1\0'+owner.seal).digest('hex'))
  throw Error('private_weather_store_scope');
 owner.assertOwned();
 return createHash('sha256').update(serial(['private-weather-rehearsal/v1',context])).digest('hex');
}
/** Caller borrows a snapshot; this never initializes or mutates the store. */
export function readPrivateWeatherRehearsalSnapshot(db:DatabaseSync,owner:DeveloperMvpSpiritFixtureOwner,context:DisconnectedWeatherUseContext){
 const scope=privateWeatherRehearsalScope(owner,context);
 const seal=db.prepare('SELECT * FROM mvp_spirit_developer_fixture LIMIT 2').all();
 if(seal.length!==1||Object.keys(seal[0]).length!==2||seal[0].version!==1||seal[0].seal!==owner.seal)
  throw Error('private_weather_store_seal');
 const t=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(TABLE);
 if(!t)return {text:null,rows:[] as ValleySpiritAlmanacEntry[]};
 if(t.type!=='table'||t.sql!==DDL||
    db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(TABLE))
  throw Error('private_weather_store_schema');
 const stored=db.prepare(`SELECT slot,version,scope,CASE WHEN length(CAST(state AS BLOB))<=? THEN state END AS state FROM ${TABLE} LIMIT 2`).all(BYTES);
 if(stored.length!==1||stored[0].slot!==1||stored[0].version!==1||stored[0].scope!==scope||typeof stored[0].state!=='string')
  throw Error('private_weather_store_state');
 const text=stored[0].state,rows:unknown=JSON.parse(text);
 if(!valid(rows,context.worldId)||!rows.length||serial(rows)!==text)throw Error('private_weather_store_history');
 return {text,rows};
}
/** Internal storage only. Never consults, updates, or creates public almanac
 * tables. Does not certify any quota completion or recover unfinished sends. */
export function openPrivateWeatherRehearsalStore(owner:DeveloperMvpSpiritFixtureOwner,context:DisconnectedWeatherUseContext):
 ValleySpiritAlmanacStore&{close():void}{
 if(attached.has(owner))throw Error('private_weather_store_scope');
 const scope=privateWeatherRehearsalScope(owner,context);
 const db=new DatabaseSync(owner.database);
 try{
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');
  let closed=false,isolated=false,seen:string|null|undefined;
  const current=()=>{
   if(closed||isolated)throw Error('private_weather_store_unavailable');
   const state=readPrivateWeatherRehearsalSnapshot(db,owner,context);
   if(seen!==undefined&&state.text!==seen)throw Error('private_weather_store_changed');
   return state;
  };
  const opened=current();seen=opened.text;
  attached.add(owner);
  return {
   read(){
    try{return current().rows;}
    catch(e){isolated=true;throw e;}
   },
   replace(previous,next){
    if(closed||isolated||!valid(next,context.worldId)||!progresses(previous,next))return false;
    const text=serial(next);
    if(Buffer.byteLength(text)>BYTES)return false;
    let tx=false;
    try{
     owner.assertOwned();db.exec('BEGIN IMMEDIATE');tx=true;
     const {text:before,rows}=current();
     if(serial(previous)!==serial(rows)){db.exec('ROLLBACK');tx=false;return false;}
     if(before===null)db.exec(DDL);
     db.prepare(`INSERT INTO ${TABLE} VALUES (1,1,?,?) ON CONFLICT(slot) DO UPDATE SET state=excluded.state`).run(scope,text);
     owner.assertOwned();db.exec('COMMIT');tx=false;seen=text;return true;
    }catch(e){
     isolated=true;
     if(tx)try{db.exec('ROLLBACK');}catch{/* isolated */}
     throw e;
    }
   },
   close(){if(!closed){closed=true;try{db.close();}finally{attached.delete(owner);}}}
  };
 }catch(e){db.close();throw e;}
}
