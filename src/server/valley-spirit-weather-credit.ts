import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {publicWeatherEntryId,publicWeatherProjection,validPublicWeatherFact,type PublicWeatherFact} from './valley-spirit.js';
import {readValleySpiritWeatherPermission} from './valley-spirit-permissions.js';

const table='valley_spirit_native_weather_credit';
const ddl=`CREATE TABLE ${table}(world_id TEXT NOT NULL,source_id TEXT NOT NULL,schema_version INTEGER NOT NULL,
 permission_version INTEGER NOT NULL,world_revision INTEGER NOT NULL,at_us TEXT NOT NULL,projection_digest TEXT NOT NULL,
 PRIMARY KEY(world_id,source_id))`;
const columns=[['world_id','TEXT',1],['source_id','TEXT',2],['schema_version','INTEGER',0],
 ['permission_version','INTEGER',0],['world_revision','INTEGER',0],['at_us','TEXT',0],['projection_digest','TEXT',0]] as const;
function exists(db:DatabaseSync):boolean {
 const t=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(table);
 if(!t)return false;
 const c=db.prepare('PRAGMA table_info(valley_spirit_native_weather_credit)').all();
 if(t.type!=='table'||t.sql!==ddl||c.length!==columns.length||c.some((v,i)=>v.name!==columns[i][0]||v.type!==columns[i][1]||v.pk!==columns[i][2]||v.notnull!==1)||
    db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(table))throw Error('native_weather_credit_schema');
 return true;
}
function digest(f:PublicWeatherFact):string {
 return createHash('sha256').update(JSON.stringify(['valley-spirit-native-weather-credit/v1',f.projectionVersion,f.worldId,
  f.worldRevision,f.minute,f.atUs,f.condition,f.temperatureDeciC,f.relativeHumidityPermille,f.cloudPermille,f.windPermille,
  f.daylightPermille,f.precipitationPermille])).digest('hex');
}
/** Internal: invoked only from the sealed WorldStore commit SAVEPOINT. No file reads/writes. */
export function appendNativeWeatherCredit(db:DatabaseSync,previous:World|null,world:World,previousRevision:number):void {
 if(!previous||previous.clock.paused||world.clock.paused)return;
 const before=publicWeatherProjection(previous),f=publicWeatherProjection(world);
 // The world write validated its compare-and-swap before this SAVEPOINT.
 // Native plan submission may increment revision multiple times in one clock minute.
 if(!before||!f||before.worldId!==f.worldId||before.worldRevision!==previousRevision||
    f.worldRevision<=before.worldRevision||f.minute!==before.minute+1||
    BigInt(f.atUs)-BigInt(before.atUs)!==1_000_000n)return;
 const grant=readValleySpiritWeatherPermission(db,f.worldId);
 if(!grant?.publicWeather)return;
 const id=publicWeatherEntryId(f,grant.version);
 if(!exists(db))db.exec(ddl);
 db.prepare(`INSERT INTO ${table} VALUES (?,?,1,?,?,?,?) ON CONFLICT(world_id,source_id) DO NOTHING`)
  .run(f.worldId,id,grant.version,f.worldRevision,f.atUs,digest(f));
}
/** Borrow the caller's snapshot; every selected source needs one exact credit.
 * This checks the current SQLite grant once and does not accept one from callers. */
export function verifyNativeWeatherCreditBatch(db:DatabaseSync,worldId:string,
 sources:readonly {sourceRef:string;fact:PublicWeatherFact}[]):boolean {
 try{
  if(!sources.length||sources.length>48)return false;
  const g=readValleySpiritWeatherPermission(db,worldId);
  if(!g?.publicWeather||!exists(db))return false;
  const stmt=db.prepare(`SELECT schema_version,permission_version,world_revision,at_us,projection_digest FROM ${table} WHERE world_id=? AND source_id=?`);
  return sources.every(({sourceRef,fact})=>{
   if(!validPublicWeatherFact(fact)||fact.worldId!==worldId)return false;
   const id=publicWeatherEntryId(fact,g.version);
   if(sourceRef!==worldId+'/'+id)return false;
   const row=stmt.get(worldId,id);
   return !!row&&row.schema_version===1&&row.permission_version===g.version&&row.world_revision===fact.worldRevision&&
    row.at_us===fact.atUs&&row.projection_digest===digest(fact);
  });
 }catch{return false;}
}
/** Credit authenticates the supplied typed projection, not JSON publication,
 * whole-database rollback resistance, or the current world head. */
export function verifiesNativeWeatherCredit(db:DatabaseSync,sourceRef:string,expected:PublicWeatherFact):boolean {
 return verifyNativeWeatherCreditBatch(db,expected?.worldId,[{sourceRef,fact:expected}]);
}
