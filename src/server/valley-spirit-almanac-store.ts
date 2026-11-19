import {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';
import {validateValleySpiritAlmanacEntries,type ValleySpiritAlmanacEntry,type ValleySpiritAlmanacStore} from './valley-spirit-almanac.js';

const TABLE='valley_spirit_almanac';
const CAP=16*1024*1024;
const COLUMNS=[
 ['world_id','TEXT',1],['schema_version','INTEGER',0],['state_json','TEXT',0],
] as const;
const tables=(db:DatabaseSync,worldId:string)=>{
 const t=db.prepare("SELECT type FROM sqlite_master WHERE name=?").get(TABLE);
 if(!t)return null;
 const columns=db.prepare('PRAGMA table_info(valley_spirit_almanac)').all();
 if(t.type!=='table'||columns.length!==COLUMNS.length||columns.some((c,i)=>c.name!==COLUMNS[i][0]||c.type!==COLUMNS[i][1]||c.pk!==COLUMNS[i][2]||c.notnull!==1))throw Error('invalid_almanac_schema');
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND type='trigger'").get(TABLE))throw Error('invalid_almanac_trigger');
 const result=db.prepare('SELECT world_id,schema_version,CASE WHEN length(CAST(state_json AS BLOB)) <= ? THEN state_json ELSE NULL END AS state_json FROM valley_spirit_almanac LIMIT 2').all(CAP);
 if(result.length>1||result.some(r=>r.world_id!==worldId||r.schema_version!==1||typeof r.state_json!=='string'))throw Error('invalid_almanac_state');
 return result[0]?.state_json as string|undefined??null;
};
function validated(text:string|null,worldId:string):ValleySpiritAlmanacEntry[]{
 const rows:unknown=text===null?[]:JSON.parse(text);
 if(!validateValleySpiritAlmanacEntries(rows)||!rows.every(e=>e.packet.worldId===worldId))throw Error('invalid_almanac_state');
 return rows;
}
/** Used on the authoritative save's private preflight copy, before writable
 * WorldStore opens. This inspector makes no migrations or repairs. */
export function inspectValleySpiritAlmanac(db:DatabaseSync,worldId:string):void {
 validated(tables(db,worldId),worldId);
}
/** Runtime viewer owns a physically read-only SQLite connection. */
export class SqliteValleySpiritAlmanacReader {
 private readonly db:DatabaseSync;
 constructor(database:string,private readonly worldId:string,private readonly assertOwned:()=>void){
  assertOwned();this.db=new DatabaseSync(database,{readOnly:true});
  try{this.db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');inspectValleySpiritAlmanac(this.db,worldId);}catch(e){this.db.close();throw e;}
 }
 read():ValleySpiritAlmanacEntry[]{
  this.assertOwned();return validated(tables(this.db,this.worldId),this.worldId);
 }
 close(){this.db.close();}
}
/** Read-only optional-module preflight on a previously validated world DB.
 * A bad almanac is isolated by the caller; never repair/overwrite it here.
 * Callers own the same actor-independent runtime lease as the world writer. */
export function preflightValleySpiritAlmanac(database:string,worldId:string,assertOwned:()=>void):void {
 assertOwned();
 const file=lstatSync(database);
 if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1)throw Error('unsafe_almanac_database');
 const db=new DatabaseSync(database,{readOnly:true});
 try{db.exec('PRAGMA trusted_schema=OFF');inspectValleySpiritAlmanac(db,worldId);}finally{db.close();}
}
export class SqliteValleySpiritAlmanacStore implements ValleySpiritAlmanacStore {
 private readonly db:DatabaseSync;
 constructor(database:string,private readonly worldId:string,private readonly assertOwned:()=>void){
  preflightValleySpiritAlmanac(database,worldId,assertOwned);
  assertOwned();this.db=new DatabaseSync(database);
  try{this.db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');}catch(e){this.db.close();throw e;}
 }
 read():ValleySpiritAlmanacEntry[]{
  this.assertOwned();return validated(tables(this.db,this.worldId),this.worldId);
 }
 replace(previous:readonly ValleySpiritAlmanacEntry[],next:readonly ValleySpiritAlmanacEntry[]):boolean {
  this.assertOwned();
  if(!validateValleySpiritAlmanacEntries(next)||!next.every(e=>e.packet.worldId===this.worldId))return false;
  const serialized=JSON.stringify(next);if(Buffer.byteLength(serialized)>CAP)return false;
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const raw=tables(this.db,this.worldId),stored=validated(raw,this.worldId);
   if(JSON.stringify(stored)!==JSON.stringify(previous)){
    this.db.exec('ROLLBACK');return false;
   }
   const tableExists=this.db.prepare("SELECT type FROM sqlite_master WHERE name=?").get(TABLE);
   if(!tableExists)this.db.exec('CREATE TABLE valley_spirit_almanac(world_id TEXT PRIMARY KEY NOT NULL,schema_version INTEGER NOT NULL,state_json TEXT NOT NULL)');
   this.db.prepare('INSERT INTO valley_spirit_almanac VALUES (?,1,?) ON CONFLICT(world_id) DO UPDATE SET state_json=excluded.state_json').run(this.worldId,serialized);
   this.assertOwned();this.db.exec('COMMIT');return true;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 close(){this.db.close();}
}
