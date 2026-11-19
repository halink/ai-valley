import {createHash} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {decodeSavedWorld} from './save-preflight.js';
import {verifyValleySpiritFormalArrivalCustody,type ValleySpiritFormalArrivalReceipt} from './valley-spirit-formal-arrival-custody.js';

const MODE='offline-formal-arrival-publication' as const;
const AUDIENCE='valley-spirit-public' as const;
const TABLE='valley_spirit_formal_arrival_releases';
const MAX_OPERATIONS=128,MAX_BYTES=64*1024;
const DDL='CREATE TABLE valley_spirit_formal_arrival_releases(world_id TEXT NOT NULL,receipt_id TEXT NOT NULL,schema_version INTEGER NOT NULL,operations_json TEXT NOT NULL,PRIMARY KEY(world_id,receipt_id))';
const exact=(v:unknown,keys:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const clock=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&BigInt(v)<=1_000_000_000_000_000n;

export interface ValleySpiritFormalArrivalReleaseBasis {
 readonly audience:typeof AUDIENCE;
 readonly worldId:string;
 readonly sourceRef:string;
 readonly receiptDigest:string;
 readonly grantVersion:number;
}
export interface ValleySpiritFormalArrivalDisclosure extends ValleySpiritFormalArrivalReleaseBasis {readonly allow:boolean;}
export interface ValleySpiritFormalArrivalPublishedView {
 readonly schemaVersion:1;readonly status:'ready';readonly worldId:string;readonly sectionId:string;
 readonly sourceRef:string;readonly grantVersion:number;readonly receiptVersion:1;
 readonly kind:'arrived';readonly atUs:string;readonly text:string;
 readonly generatedBy:'offline-fixed-factual-template';
}
type Operation={readonly type:'disclosure';readonly grantVersion:number;readonly allow:boolean;
 readonly sourceRef:string;readonly receiptDigest:string}|
 {readonly type:'publication';readonly grantVersion:number;readonly sectionId:string};
interface Options {
 readonly mode?:typeof MODE;
 readonly database:string;
 readonly receipt:Readonly<ValleySpiritFormalArrivalReceipt>;
 readonly assertOwned:()=>void;
 /** If the host knows a newer disclosure turn, an older restored file must
  * not be reusable even on the first read after reopening. */
 readonly minimumGrantVersion?:number;
}
function regular(path:string){
 const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('unsafe_formal_arrival_release_database');return s;
}
const sameFile=(a:ReturnType<typeof regular>,b:ReturnType<typeof regular>)=>a.dev===b.dev&&a.ino===b.ino;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function hasTable(db:DatabaseSync):boolean{
 const m=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(TABLE);
 if(!m)return false;
 if(m.type!=='table'||m.sql!==DDL||db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND type='trigger'").get(TABLE))
  throw Error('unknown_formal_arrival_release_schema');
 return true;
}
const sourceRef=(r:ValleySpiritFormalArrivalReceipt)=>r.worldId+'/life-'+hash([r.worldId,r.kind,r.receiptId]);
const digest=(r:ValleySpiritFormalArrivalReceipt)=>hash([r.schemaVersion,r.worldId,r.kind,r.receiptId,r.receiptVersion,r.atUs]);
const sectionId=(r:ValleySpiritFormalArrivalReceipt,grantVersion:number)=>'valley-formal-life-'+hash([1,sourceRef(r),digest(r),grantVersion,r.atUs]);
const prefix=(seen:readonly Operation[],next:readonly Operation[])=>next.length>=seen.length&&seen.every((op,i)=>same(op,next[i]));
function parse(log:unknown,r:ValleySpiritFormalArrivalReceipt){
 if(!Array.isArray(log)||log.length>MAX_OPERATIONS)throw Error('unknown_formal_arrival_release_log');
 let version=0,allowed=false;
 let publication:Extract<Operation,{type:'publication'}>|null=null;
 for(const op of log){
  if(op?.type==='disclosure'){
   if(!exact(op,['type','grantVersion','allow','sourceRef','receiptDigest'])||
    op.sourceRef!==sourceRef(r)||op.receiptDigest!==digest(r)||!natural(op.grantVersion)||op.grantVersion!==version+1||
    typeof op.allow!=='boolean'||op.allow===allowed)throw Error('invalid_formal_arrival_disclosure');
   version=op.grantVersion;allowed=op.allow;publication=null;
  }else if(op?.type==='publication'){
   if(!exact(op,['type','grantVersion','sectionId'])||!allowed||publication||op.grantVersion!==version||
    op.sectionId!==sectionId(r,version))throw Error('invalid_formal_arrival_publication');
   publication=op;
  }else throw Error('invalid_formal_arrival_release_operation');
 }
 if(log.length+(allowed?1:0)>MAX_OPERATIONS)throw Error('unsafe_formal_arrival_release_capacity');
 return {log:log as Operation[],version,allowed,publication};
}
function readState(db:DatabaseSync,r:ValleySpiritFormalArrivalReceipt){
 if(!hasTable(db))return parse([],r);
 const row=db.prepare(`SELECT schema_version, CASE WHEN length(CAST(operations_json AS BLOB))<=? THEN operations_json END AS ops
  FROM valley_spirit_formal_arrival_releases WHERE world_id=? AND receipt_id=?`).get(MAX_BYTES,r.worldId,r.receiptId);
 if(!row)return parse([],r);
 if(row.schema_version!==1||typeof row.ops!=='string')throw Error('unknown_formal_arrival_release_state');
 return parse(JSON.parse(row.ops),r);
}
function custodyAtCurrentHead(db:DatabaseSync,r:ValleySpiritFormalArrivalReceipt):boolean{
 if(!verifyValleySpiritFormalArrivalCustody(db,r))return false;
 const row=db.prepare('SELECT id,revision,state FROM worlds WHERE id=?').get(r.worldId);
 if(!row)return false;
 const head=decodeSavedWorld(row.state);
 if(head.id!==row.id||head.id!==r.worldId||head.mode!=='formal'||head.revision!==row.revision||typeof head.minute!=='number')return false;
 const us=minuteToClimateUs(head.minute);
 return clock(us)&&BigInt(r.atUs)<=BigInt(us);
}
type State=ReturnType<typeof readState>;
/** A release binds one actual formal receipt and a live, caller-owned
 * authority. It never adopts another world ID or enters any normal runtime. */
abstract class FormalArrivalAttachment {
 protected readonly db:DatabaseSync;
 protected readonly receipt:ValleySpiritFormalArrivalReceipt;
 private readonly file:ReturnType<typeof regular>;
 private readonly options:Options;
 protected isolated=false;
 protected seen:readonly Operation[];
 constructor(options:Options,write:boolean){
  if(options.mode!==MODE)throw Error('formal_arrival_release_disabled');
  if(options.minimumGrantVersion!==undefined&&!natural(options.minimumGrantVersion))throw Error('invalid_formal_arrival_release_fence');
  this.receipt=Object.freeze({...options.receipt});
  this.options=Object.freeze({...options,receipt:this.receipt});
  options.assertOwned();this.file=regular(options.database);
  const pre=new DatabaseSync(options.database,{readOnly:true});
  try{
   pre.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
   if(!sameFile(this.file,regular(options.database))||!custodyAtCurrentHead(pre,this.receipt))throw Error('formal_arrival_release_unavailable');
   const initial=readState(pre,this.receipt);
   if(initial.version<(options.minimumGrantVersion??0))throw Error('rewound_formal_arrival_release_state');
   this.seen=initial.log;options.assertOwned();
  }finally{pre.close();}
  this.db=new DatabaseSync(options.database,{readOnly:!write});
  try{
   this.db.exec(write?'PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL':'PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
   this.transaction(false,()=>true);
  }catch(e){this.db.close();throw e;}
 }
 protected transaction<T>(write:boolean,op:(state:State)=>T):T {
  if(this.isolated)throw Error('formal_arrival_release_isolated');
  this.options.assertOwned();
  if(!sameFile(this.file,regular(this.options.database)))throw Error('changed_formal_arrival_release_database');
  this.db.exec(write?'BEGIN IMMEDIATE':'BEGIN');
  try{
   if(!custodyAtCurrentHead(this.db,this.receipt))throw Error('formal_arrival_custody_unavailable');
   const state=readState(this.db,this.receipt);
   if(!prefix(this.seen,state.log)||state.version<(this.options.minimumGrantVersion??0))throw Error('rewound_formal_arrival_release_state');
   this.seen=state.log;
   const result=op(state);
   this.options.assertOwned();if(!sameFile(this.file,regular(this.options.database)))throw Error('changed_formal_arrival_release_database');
   this.db.exec('COMMIT');return result;
  }catch(e){try{this.db.exec('ROLLBACK');}catch{this.isolated=true;}throw e;}
 }
 protected projectBasis(state:State):ValleySpiritFormalArrivalReleaseBasis {
  const r=this.receipt;return Object.freeze({audience:AUDIENCE,worldId:r.worldId,sourceRef:sourceRef(r),
   receiptDigest:digest(r),grantVersion:state.version});
 }
 protected matchesBasis(state:State,v:unknown):boolean{
  if(!exact(v,['audience','worldId','sourceRef','receiptDigest','grantVersion']))return false;
  const x=v as ValleySpiritFormalArrivalReleaseBasis,b=this.projectBasis(state);
  return x.audience===b.audience&&x.worldId===b.worldId&&x.sourceRef===b.sourceRef&&
   x.receiptDigest===b.receiptDigest&&x.grantVersion===b.grantVersion;
 }
 close(){this.db.close();}
}
export class ValleySpiritFormalArrivalRelease extends FormalArrivalAttachment {
 constructor(options:Options,private readonly verifyApproval:(decision:Readonly<ValleySpiritFormalArrivalDisclosure>)=>boolean){
  super(options,true);
 }
 basis():ValleySpiritFormalArrivalReleaseBasis|null {
  try{return this.transaction(false,s=>this.projectBasis(s));}catch{return null;}
 }
 private write(state:State,op:Operation):readonly Operation[]{
  const next=[...state.log,op],body=JSON.stringify(next);
  parse(next,this.receipt);
  if(Buffer.byteLength(body)>MAX_BYTES)throw Error('formal_arrival_release_capacity');
  if(!hasTable(this.db))this.db.exec(DDL);
  this.db.prepare(`INSERT INTO valley_spirit_formal_arrival_releases VALUES (?,?,1,?)
    ON CONFLICT(world_id,receipt_id) DO UPDATE SET operations_json=excluded.operations_json`).run(
     this.receipt.worldId,this.receipt.receiptId,body);
  return next;
 }
 setDisclosure(decision:ValleySpiritFormalArrivalDisclosure):boolean{
  if(!exact(decision,['audience','worldId','sourceRef','receiptDigest','grantVersion','allow'])||typeof decision.allow!=='boolean')return false;
  const proposed=Object.freeze({...decision});
  try{
   const next=this.transaction(true,state=>{
    const {allow,...basis}=proposed;
    if(!this.matchesBasis(state,basis)||allow===state.allowed||this.verifyApproval(proposed)!==true)return null;
    return this.write(state,{type:'disclosure',grantVersion:state.version+1,allow,
     sourceRef:basis.sourceRef,receiptDigest:basis.receiptDigest});
   });
   if(!next)return false;this.seen=next;return true;
  }catch{return false;}
 }
 publish(basis:ValleySpiritFormalArrivalReleaseBasis):'published'|'unavailable'{
  try{
   const next=this.transaction(true,state=>{
    if(!state.allowed||state.publication||!this.matchesBasis(state,basis))return null;
    return this.write(state,{type:'publication',grantVersion:state.version,sectionId:sectionId(this.receipt,state.version)});
   });
   if(!next)return 'unavailable';this.seen=next;return 'published';
  }catch{return 'unavailable';}
 }
}
/** No route: use only as a private/offline read. Every read checks live grant,
 * original world and original custody; never fall back to older publications. */
export class ValleySpiritFormalArrivalViewer extends FormalArrivalAttachment {
 constructor(options:Options & {readonly minimumGrantVersion:number}){
  if(options.mode===MODE&&!natural(options.minimumGrantVersion))throw Error('formal_arrival_release_requires_host_fence');
  super(options,false);
 }
 current(worldId:string,expectedSectionId?:string):ValleySpiritFormalArrivalPublishedView|null{
  if(worldId!==this.receipt.worldId)return null;
  try{return this.transaction(false,state=>{
   if(!state.allowed||!state.publication||expectedSectionId!==undefined&&state.publication.sectionId!==expectedSectionId)return null;
   const r=this.receipt,whole=BigInt(r.atUs)/1_000_000n,part=BigInt(r.atUs)%1_000_000n;
   const minute=part===0n?String(whole):String(whole)+'.'+String(part).padStart(6,'0').replace(/0+$/,'');
   return Object.freeze({schemaVersion:1,status:'ready',worldId:r.worldId,sectionId:state.publication.sectionId,
    sourceRef:sourceRef(r),grantVersion:state.version,receiptVersion:1,kind:'arrived',atUs:r.atUs,
    text:'游戏分钟 '+minute+'：记录到一次实际到场。',generatedBy:'offline-fixed-factual-template'});
  });}catch{return null;}
 }
 verify(value:Readonly<ValleySpiritFormalArrivalPublishedView>):boolean{
  try{
   if(!value||typeof value.sectionId!=='string')return false;
   const current=this.current(value.worldId,value.sectionId);
   return current!==null&&same(current,value);
  }catch{return false;}
 }
}
