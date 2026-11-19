import {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';
import {
 isValleySpiritLifeReceipt, valleySpiritLifeBinding,
 type ValleySpiritLifeAuthority, type ValleySpiritLifeReceipt,
} from './valley-spirit-life-facts.js';

const TABLE='valley_spirit_life_authority';
const VERSION=1;
const CAP=4*1024*1024, MAX_OPERATIONS=8192, MAX_REFS=24;
// Reserve an operation and enough serialized bytes to revoke each live grant.
// A full optional ledger may refuse new receipts, never trap active grants.
const REVOCATION_BYTES=512;
const proper=(v:unknown,k:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const uint=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const time=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&BigInt(v)<=1_000_000_000_000_000n;
const validWorld=(v:string)=>/^godot-mvp-[A-Za-z0-9_-]{1,180}$/.test(v);
const hex=/^[a-f0-9]{64}$/;

type Operation={type:'receipt';receipt:ValleySpiritLifeReceipt}|{type:'grant';sourceRef:string;receiptDigest:string;priorGrantVersion:number;allow:boolean};
type Row={receipt:ValleySpiritLifeReceipt;digest:string;grantVersion:number;allow:boolean};
interface State { operations:Operation[]; sources:Map<string,Row>; tokens:Map<string,string>; activeGrants:number; }
export interface ValleySpiritLifeCommittedHead {readonly worldId:string;readonly asOfUs:string;}
export interface ValleySpiritLifeGrantDecision {
 readonly worldId:string;readonly sourceRef:string;readonly receiptDigest:string;readonly priorGrantVersion:number;readonly allow:boolean;
}
export interface ValleySpiritLifeWriteAuthority {
 /** Resolve/check the exact already-committed typed terminal receipt. Not an input parser. */
 verifyCommitted(receipt:Readonly<ValleySpiritLifeReceipt>):boolean;
 /** Validate explicit source-specific permission authority, not UI visibility or consent inference. */
 verifyApproval(decision:Readonly<ValleySpiritLifeGrantDecision>):boolean;
}
function assertWorld(worldId:string){
 if(!validWorld(worldId))throw Error('invalid_life_authority_world');
}
function hasTable(db:DatabaseSync):boolean {
 const master=db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(TABLE);
 if(!master)return false;
 const columns=db.prepare('PRAGMA table_info(valley_spirit_life_authority)').all();
 const expected=[['world_id','TEXT',1],['schema_version','INTEGER',0],['operations_json','TEXT',0]];
 if(master.type!=='table'||columns.length!==expected.length||columns.some((c,i)=>c.name!==expected[i][0]||c.type!==expected[i][1]||c.pk!==expected[i][2]||c.notnull!==1)||
   db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND type='trigger'").get(TABLE))
   throw Error('unknown_life_authority_schema');
 return true;
}
function step(state:State,op:unknown,worldId:string):boolean{
 if(!op||typeof op!=='object'||Array.isArray(op))return false;
 const v=op as Operation;
 if(v.type==='receipt'){
  if(!proper(v,['type','receipt'])||!isValleySpiritLifeReceipt(v.receipt)||v.receipt.worldId!==worldId)return false;
  const f=v.receipt,{sourceRef,receiptDigest}=valleySpiritLifeBinding(f),recent=state.sources.get(sourceRef),token=state.tokens.get(f.receiptId);
  if((token!==undefined&&token!==sourceRef)||f.receiptVersion!==(recent?.receipt.receiptVersion??0)+1)return false;
  const grantVersion=recent?recent.grantVersion+1:0; // a correction invalidates every previous grant immediately
  if(!uint(grantVersion))return false;
  if(recent?.allow)state.activeGrants--;
  state.sources.set(sourceRef,{receipt:f,digest:receiptDigest,grantVersion,allow:false});
  state.tokens.set(f.receiptId,sourceRef);
  return true;
 }
 if(v.type==='grant'){
  if(!proper(v,['type','sourceRef','receiptDigest','priorGrantVersion','allow'])||typeof v.sourceRef!=='string'||
   typeof v.receiptDigest!=='string'||!hex.test(v.receiptDigest)||!uint(v.priorGrantVersion)||typeof v.allow!=='boolean')return false;
  const recent=state.sources.get(v.sourceRef);
  if(!recent||recent.digest!==v.receiptDigest||recent.grantVersion!==v.priorGrantVersion||recent.allow===v.allow||
   !uint(recent.grantVersion+1))return false;
  state.activeGrants+=v.allow?1:-1;
  state.sources.set(v.sourceRef,{...recent,allow:v.allow,grantVersion:recent.grantVersion+1});
  return true;
 }
 return false;
}
function read(db:DatabaseSync,worldId:string):State{
 const operations:Operation[]=[];
 const state:State={operations,sources:new Map(),tokens:new Map(),activeGrants:0};
 if(!hasTable(db))return state;
 const rows=db.prepare('SELECT world_id,schema_version,CASE WHEN length(CAST(operations_json AS BLOB))<=? THEN operations_json ELSE NULL END AS operations_json FROM valley_spirit_life_authority LIMIT 2').all(CAP);
 if(rows.length!==1||rows[0].world_id!==worldId||rows[0].schema_version!==VERSION||typeof rows[0].operations_json!=='string')throw Error('unknown_life_authority_state');
 const decoded:unknown=JSON.parse(rows[0].operations_json);
 if(!Array.isArray(decoded)||decoded.length<1||decoded.length>MAX_OPERATIONS)throw Error('unknown_life_authority_state');
 for(const op of decoded){if(!step(state,op,worldId))throw Error('unknown_life_authority_state');operations.push(op as Operation);}
 if(operations.length+state.activeGrants>MAX_OPERATIONS||Buffer.byteLength(rows[0].operations_json)+state.activeGrants*REVOCATION_BYTES>CAP)throw Error('unsafe_life_authority_capacity');
 return state;
}
export function inspectValleySpiritLifeAuthority(db:DatabaseSync,worldId:string):void{
 assertWorld(worldId);
 read(db,worldId);
}
const safePath=(database:string)=>{
 const s=lstatSync(database);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('unsafe_life_authority_database');
 return s;
};
const sameFile=(a:ReturnType<typeof safePath>,b:ReturnType<typeof safePath>)=>a.ino===b.ino&&a.dev===b.dev;
const extendsHistory=(seen:readonly Operation[],next:readonly Operation[])=>next.length>=seen.length&&
 seen.every((operation,i)=>JSON.stringify(operation)===JSON.stringify(next[i]));
function connect(database:string,worldId:string,assertOwned:()=>void){
 assertOwned();
 const before=safePath(database);
 const db=new DatabaseSync(database,{readOnly:true});
 try{
  if(!sameFile(before,safePath(database)))throw Error('changed_life_authority_database');
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
  assertWorld(worldId);const state=read(db,worldId);
  assertOwned();return {db,before,state};
 }catch(e){db.close();throw e;}
}
/** Internal reader borrowing a caller-owned connection; never closes it. */
export function valleySpiritLifeAuthorityOnConnection(db:DatabaseSync,expectedWorld:string,guard:()=>void,
 committedHead:()=>ValleySpiritLifeCommittedHead|null,
 isCurrentReceipt:(receipt:Readonly<ValleySpiritLifeReceipt>,head:ValleySpiritLifeCommittedHead)=>boolean):ValleySpiritLifeAuthority {
 return lifeReaderWithPrefix(db,expectedWorld,guard,committedHead,isCurrentReceipt,[]);
}
function lifeReaderWithPrefix(db:DatabaseSync,expectedWorld:string,guard:()=>void,
 committedHead:()=>ValleySpiritLifeCommittedHead|null,
 isCurrentReceipt:(receipt:Readonly<ValleySpiritLifeReceipt>,head:ValleySpiritLifeCommittedHead)=>boolean,
 initial:Operation[]):ValleySpiritLifeAuthority {
 assertWorld(expectedWorld);
 let seen=initial,isolated=false;
 return {readCurrent(worldId:string,sourceRefs:readonly string[]):unknown{
  if(isolated||worldId!==expectedWorld||!Array.isArray(sourceRefs)||!sourceRefs.length||sourceRefs.length>MAX_REFS||
    new Set(sourceRefs).size!==sourceRefs.length||sourceRefs.some(ref=>typeof ref!=='string'||!ref.startsWith(worldId+'/life-')||!hex.test(ref.slice(worldId.length+6))))return null;
  try{
   guard();
   const head=committedHead();
   if(head?.worldId!==worldId||!time(head.asOfUs))return null;
   const state=read(db,worldId);
   if(!extendsHistory(seen,state.operations))throw Error('rewound_life_authority_history');
   seen=state.operations;
   const rows=[];
   for(const sourceRef of sourceRefs){
    const row=state.sources.get(sourceRef);
    if(!row?.allow||BigInt(row.receipt.atUs)>BigInt(head.asOfUs)||isCurrentReceipt(Object.freeze({...row.receipt}),head)!==true)return null;
    rows.push({receipt:{...row.receipt},grant:{audience:'valley-spirit-public',status:'granted',grantVersion:row.grantVersion,
     worldId,sourceRef,receiptVersion:row.receipt.receiptVersion,receiptDigest:row.digest}});
   }
   guard();
   return {schemaVersion:VERSION,worldId,asOfUs:head.asOfUs,rows};
  }catch{isolated=true;return null;}
 }};
}
/** Physical read-only handle; absence and denied receipts are indistinguishable. */
export class SqliteValleySpiritLifeReader implements ValleySpiritLifeAuthority{
 private readonly db:DatabaseSync;
 private readonly reader:ValleySpiritLifeAuthority;
 constructor(database:string,worldId:string,assertOwned:()=>void,
  committedHead:()=>ValleySpiritLifeCommittedHead|null,
  isCurrentReceipt:(receipt:Readonly<ValleySpiritLifeReceipt>,head:ValleySpiritLifeCommittedHead)=>boolean){
  const {db,before,state}=connect(database,worldId,assertOwned);
  this.db=db;
  // Keep the initially validated prefix, without resolving any receipt at open.
  this.reader=lifeReaderWithPrefix(db,worldId,()=>{
   assertOwned();
   if(!sameFile(before,safePath(database)))throw Error('changed_life_authority_database');
  },committedHead,isCurrentReceipt,state.operations);
 }
 readCurrent(worldId:string,sourceRefs:readonly string[]):unknown{return this.reader.readCurrent(worldId,sourceRefs);}
 close(){this.db.close();}
}

/** Private trusted implementation seam. No default approval, no HTTP writer,
 * no migration, no receipt creation from raw events or model text. */
export class SqliteValleySpiritLifeStore{
 private readonly db:DatabaseSync;
 private readonly file:ReturnType<typeof safePath>;
 private isolated=false;
 private seen:Operation[];
 constructor(private readonly database:string,private readonly worldId:string,private readonly assertOwned:()=>void,
   private readonly committedHead:()=>ValleySpiritLifeCommittedHead|null,private readonly authority:ValleySpiritLifeWriteAuthority){
  const checked=connect(database,worldId,assertOwned);checked.db.close();
  this.file=checked.before;this.seen=checked.state.operations;
  assertOwned();if(!sameFile(this.file,safePath(database)))throw Error('changed_life_authority_database');
  this.db=new DatabaseSync(database,{open:true});
  try{
   if(!sameFile(this.file,safePath(database)))throw Error('changed_life_authority_database');
   this.db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');
   if(!extendsHistory(this.seen,read(this.db,worldId).operations))throw Error('rewound_life_authority_history');
  }catch(e){this.db.close();throw e;}
 }
 private save(op:Operation,authorize:(state:State,head:ValleySpiritLifeCommittedHead)=>boolean):boolean{
  if(this.isolated)return false;
  let open=false;
  try{
   this.assertOwned();
   if(!sameFile(this.file,safePath(this.database)))throw Error('changed_life_authority_database');
   this.db.exec('BEGIN IMMEDIATE');open=true;
   const state=read(this.db,this.worldId),head=this.committedHead();
   if(!extendsHistory(this.seen,state.operations))throw Error('rewound_life_authority_history');
   this.seen=state.operations;
   if(head?.worldId!==this.worldId||!time(head.asOfUs)||state.operations.length>=MAX_OPERATIONS||
    !authorize(state,head)||!step(state,op,this.worldId))return false;
   const body=JSON.stringify([...state.operations,op]);
   if(state.operations.length+1+state.activeGrants>MAX_OPERATIONS||Buffer.byteLength(body)+state.activeGrants*REVOCATION_BYTES>CAP)return false;
   if(!hasTable(this.db))this.db.exec('CREATE TABLE valley_spirit_life_authority(world_id TEXT PRIMARY KEY NOT NULL,schema_version INTEGER NOT NULL,operations_json TEXT NOT NULL)');
   this.db.prepare('INSERT INTO valley_spirit_life_authority VALUES (?,1,?) ON CONFLICT(world_id) DO UPDATE SET operations_json=excluded.operations_json').run(this.worldId,body);
   this.assertOwned();this.db.exec('COMMIT');open=false;this.seen=[...state.operations,op];return true;
  }catch{this.isolated=true;return false;}
  finally{if(open)try{this.db.exec('ROLLBACK');}catch{this.isolated=true;}}
 }
 recordCommitted(receipt:ValleySpiritLifeReceipt):boolean{
  if(!isValleySpiritLifeReceipt(receipt)||receipt.worldId!==this.worldId)return false;
  const copy=Object.freeze({...receipt});
  return this.save({type:'receipt',receipt:copy},(_state,head)=>BigInt(copy.atUs)<=BigInt(head.asOfUs)&&this.authority.verifyCommitted(copy)===true);
 }
 setPublic(decision:ValleySpiritLifeGrantDecision):boolean{
  if(!proper(decision,['worldId','sourceRef','receiptDigest','priorGrantVersion','allow'])||decision.worldId!==this.worldId||
   typeof decision.sourceRef!=='string'||typeof decision.receiptDigest!=='string'||!hex.test(decision.receiptDigest)||
   !uint(decision.priorGrantVersion)||typeof decision.allow!=='boolean')return false;
  const copy=Object.freeze({...decision}),{sourceRef,receiptDigest,priorGrantVersion,allow}=copy;
  return this.save({type:'grant',sourceRef,receiptDigest,priorGrantVersion,allow},(state,head)=>{
   const current=state.sources.get(sourceRef);
   return !!current&&BigInt(current.receipt.atUs)<=BigInt(head.asOfUs)&&current.digest===receiptDigest&&
    current.grantVersion===priorGrantVersion&&current.allow!==allow&&(!allow||this.authority.verifyCommitted(Object.freeze({...current.receipt}))===true)&&
    this.authority.verifyApproval(copy)===true;
  });
 }
 close(){this.db.close();}
}
