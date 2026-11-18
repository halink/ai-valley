import {DatabaseSync} from 'node:sqlite';
export interface ValleySpiritPermission {version:number;publicWeather:boolean;}
export interface ValleySpiritPermissionAuthority {
 read():ValleySpiritPermission|null;
 initialize():ValleySpiritPermission;
 advance(previous:ValleySpiritPermission,next:ValleySpiritPermission):void;
}
/** Independent G0 metadata in the authoritative world's SQLite, not World JSON.
 * Caller holds the world's existing runtime lock. No file I/O inside this table's
 * transactions. A journal backup cannot roll back this separate permission anchor. */
export class SqliteValleySpiritPermissions implements ValleySpiritPermissionAuthority {
 private db:DatabaseSync;
 constructor(database:string,private worldId:string,private assertOwned:()=>void){assertOwned();this.db=new DatabaseSync(database);}
 private table():boolean {
  const row=this.db.prepare("SELECT type FROM sqlite_master WHERE name='valley_spirit_permissions'").get();if(!row)return false;
  if(row.type!=='table')throw Error('valley_spirit_permission_schema');
  const columns=this.db.prepare('PRAGMA table_info(valley_spirit_permissions)').all();
  const expected=[['world_id','TEXT',1],['schema_version','INTEGER',0],['permission_version','INTEGER',0],['public_weather','INTEGER',0]];
  if(columns.length!==expected.length||columns.some((c,i)=>c.name!==expected[i][0]||c.type!==expected[i][1]||c.pk!==expected[i][2]||c.notnull!==1))throw Error('valley_spirit_permission_schema');return true;
 }
 read():ValleySpiritPermission|null {
  this.assertOwned();if(!this.table())return null;const row=this.db.prepare('SELECT schema_version,permission_version,public_weather FROM valley_spirit_permissions WHERE world_id=?').get(this.worldId);if(!row)throw Error('valley_spirit_permission_anchor_missing');
  if(row.schema_version!==1||typeof row.permission_version!=='number'||!Number.isSafeInteger(row.permission_version)||row.permission_version<1||!([0,1] as unknown[]).includes(row.public_weather))throw Error('valley_spirit_permission_state');
  return {version:row.permission_version,publicWeather:row.public_weather===1};
 }
 initialize():ValleySpiritPermission {
  this.assertOwned();this.db.exec('BEGIN IMMEDIATE');try{
   if(this.read())throw Error('valley_spirit_permission_already_initialized');
   if(!this.table())this.db.exec('CREATE TABLE valley_spirit_permissions (world_id TEXT PRIMARY KEY NOT NULL,schema_version INTEGER NOT NULL,permission_version INTEGER NOT NULL,public_weather INTEGER NOT NULL)');
   this.db.prepare('INSERT INTO valley_spirit_permissions VALUES (?,1,1,1)').run(this.worldId);this.db.exec('COMMIT');return {version:1,publicWeather:true};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 advance(previous:ValleySpiritPermission,next:ValleySpiritPermission):void {
  this.assertOwned();const current=this.read();if(!current||current.version!==previous.version||current.publicWeather!==previous.publicWeather||!Number.isSafeInteger(next.version)||next.version!==previous.version+1||typeof next.publicWeather!=='boolean')throw Error('valley_spirit_permission_stale');
  const result=this.db.prepare('UPDATE valley_spirit_permissions SET permission_version=?,public_weather=? WHERE world_id=? AND schema_version=1 AND permission_version=? AND public_weather=?').run(next.version,Number(next.publicWeather),this.worldId,previous.version,Number(previous.publicWeather));if(result.changes!==1)throw Error('valley_spirit_permission_stale');
 }
 close(){this.db.close();}
}
