import {createHash} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {
 ValleySpiritLifeAlmanac,
 type ValleySpiritLifeAlmanacPacket,
 type ValleySpiritLifeAlmanacRange,
 type ValleySpiritLifeAlmanacSection,
} from './valley-spirit-life-almanac.js';
import type {ValleySpiritLifeAuthority} from './valley-spirit-life-facts.js';

const MODE='offline-synthetic-life-publication' as const;
const TABLE='valley_spirit_life_publications';
const WORLD=/^godot-mvp-[A-Za-z0-9_-]{1,180}$/;
const CAP=2*1024*1024,MAX_OPS=128;
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clock=(s:unknown):s is string=>typeof s==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(s)&&BigInt(s)<=1_000_000_000_000_000n;
const kinds=['arrived','conversation-completed','meal-consumed'];
type Packet=ValleySpiritLifeAlmanacPacket;
type Range=ValleySpiritLifeAlmanacRange;
type Section=ValleySpiritLifeAlmanacSection;
interface Menu {
 readonly schemaVersion:1;
 readonly options:readonly {readonly number:number;readonly kind:string;readonly atUs:string}[];
}
interface Reserved {readonly schemaVersion:1;readonly phase:'reserved';readonly id:string;readonly packet:Packet;readonly menu:Menu;readonly correctionOf?:string;}
type Terminal =
 | {readonly schemaVersion:1;readonly phase:'suppressed';readonly id:string}
 | {readonly schemaVersion:1;readonly phase:'published';readonly id:string;readonly section:Section};
type Op=Reserved|Terminal;
const key=(worldId:string,range:Range)=>'life-publication-'+hash([worldId,range.fromUs,range.throughUs]);
const correctionKey=(base:string,previousId:string)=>'life-publication-'+hash([base,'correction',previousId]);
const equal=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
function sameBasis(left:Packet,right:Packet):boolean {
 const sorted=(packet:Packet)=>[...packet.source.facts].sort((a,b)=>a.sourceRef<b.sourceRef?-1:a.sourceRef>b.sourceRef?1:0);
 return equal(sorted(left),sorted(right));
}
function packetShape(p:unknown,worldId:string):p is Packet {
 if(!exact(p,['schemaVersion','mode','range','source'])||p.schemaVersion!==1||p.mode!=='public-life-almanac'||
  !exact(p.range,['fromUs','throughUs'])||!clock(p.range.fromUs)||!clock(p.range.throughUs)||
  BigInt(p.range.throughUs)<BigInt(p.range.fromUs)||BigInt(p.range.throughUs)-BigInt(p.range.fromUs)>1_440_000_000n||
  !exact(p.source,['projectionVersion','mode','worldId','facts'])||p.source.worldId!==worldId||
  p.source.projectionVersion!==1||p.source.mode!=='public-completed-life-facts'||!Array.isArray(p.source.facts)||
  !p.source.facts.length||p.source.facts.length>24)return false;
 const unique=new Set<string>();
 for(const f of p.source.facts){
  if(!exact(f,['projectionVersion','sourceRef','grantVersion','receiptVersion','kind','atUs'])||
   f.projectionVersion!==1||typeof f.sourceRef!=='string'||!f.sourceRef.startsWith(worldId+'/life-')||
   !/^[a-f0-9]{64}$/.test(f.sourceRef.slice(worldId.length+6))||unique.has(f.sourceRef)||
   typeof f.grantVersion!=='number'||!Number.isSafeInteger(f.grantVersion)||f.grantVersion<1||
   typeof f.receiptVersion!=='number'||!Number.isSafeInteger(f.receiptVersion)||f.receiptVersion<1||
   typeof f.kind!=='string'||!kinds.includes(f.kind)||!clock(f.atUs)||
   BigInt(f.atUs)<BigInt(p.range.fromUs)||BigInt(f.atUs)>BigInt(p.range.throughUs))return false;
  unique.add(f.sourceRef);
 }
 return true;
}
function menuFor(p:Packet):Menu {
 return Object.freeze({schemaVersion:1,options:Object.freeze(p.source.facts.map((f,i)=>Object.freeze({number:i+1,kind:f.kind,atUs:f.atUs})))});
}
/** No caller-provided transport or executable selector; this function only
 * receives the stripped menu, not source IDs, authorization metadata or world. */
function syntheticSelect(menu:Menu){
 const ranked=[...menu.options].sort((a,b)=>BigInt(a.atUs)<BigInt(b.atUs)?-1:BigInt(a.atUs)>BigInt(b.atUs)?1:a.number-b.number);
 return {indices:ranked.slice(0,3).map(f=>f.number),wording:'time-first'};
}
interface Index {readonly ops:Op[];readonly pending:Map<string,Reserved>;readonly terminal:Set<string>;readonly latestByRange:Map<string,Section>;}
function index(value:unknown,worldId:string):Index {
 if(!Array.isArray(value)||value.length>MAX_OPS)throw Error('unknown_life_publication_state');
 const pending=new Map<string,Reserved>(),terminal=new Set<string>(),latestByRange=new Map<string,Section>();
 for(const raw of value){
  if(!raw||typeof raw!=='object'||raw.schemaVersion!==1||typeof raw.id!=='string')throw Error('unknown_life_publication_state');
  if(raw.phase==='reserved'){
   const correction=Object.hasOwn(raw,'correctionOf');
   const fields=['schemaVersion','phase','id','packet','menu',...(correction?['correctionOf']:[])];
   if(!exact(raw,fields)||!packetShape(raw.packet,worldId)||pending.has(raw.id)||
    !equal(raw.menu,menuFor(raw.packet)))throw Error('invalid_life_publication_attempt');
   const base=key(worldId,raw.packet.range);
   if(correction){
    const previous=latestByRange.get(base);
    if(!previous||raw.correctionOf!==previous.sectionId||raw.id!==correctionKey(base,previous.sectionId)||
     sameBasis(previous.packet,raw.packet))throw Error('invalid_life_publication_correction');
   }else if(raw.id!==base)throw Error('invalid_life_publication_attempt');
   pending.set(raw.id,raw as unknown as Reserved);
   continue;
  }
  const original=pending.get(raw.id);
  if(!original||terminal.has(raw.id))throw Error('invalid_life_publication_transition');
  if(raw.phase==='suppressed'){
   if(!exact(raw,['schemaVersion','phase','id']))throw Error('invalid_life_publication_transition');
  }else if(raw.phase==='published'){
   if(!exact(raw,['schemaVersion','phase','id','section'])||!exact(raw.section,['schemaVersion','rendererVersion','sectionId','packet','selection','lines'])||
    raw.section.schemaVersion!==1||raw.section.rendererVersion!==1||typeof raw.section.sectionId!=='string'||
    !equal(raw.section.packet,original.packet)||!equal(raw.section.selection,syntheticSelect(original.menu))||!Array.isArray(raw.section.lines))
    throw Error('invalid_life_publication_section');
   const {schemaVersion,rendererVersion,sectionId,packet,selection,lines}=raw.section;
   if(sectionId!=='valley-life-section-'+hash([schemaVersion,rendererVersion,packet,selection,lines]))throw Error('invalid_life_publication_seal');
   const base=key(worldId,original.packet.range),latest=latestByRange.get(base);
   if(original.correctionOf!==latest?.sectionId)throw Error('invalid_life_publication_correction');
   latestByRange.set(base,raw.section as unknown as Section);
  }else throw Error('invalid_life_publication_transition');
  terminal.add(raw.id);
 }
 if(value.length+pending.size-terminal.size>MAX_OPS)throw Error('unsafe_life_publication_capacity');
 return {ops:value as Op[],pending,terminal,latestByRange};
}
function present(db:DatabaseSync):boolean{
 const m=db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(TABLE);
 if(!m)return false;
 const cols=db.prepare('PRAGMA table_info(valley_spirit_life_publications)').all();
 const expected=[['world_id','TEXT',1],['schema_version','INTEGER',0],['operations_json','TEXT',0]];
 if(m.type!=='table'||cols.length!==expected.length||cols.some((c,i)=>c.name!==expected[i][0]||c.type!==expected[i][1]||
  c.pk!==expected[i][2]||c.notnull!==1)||db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND type='trigger'").get(TABLE))throw Error('unknown_life_publication_schema');
 return true;
}
function read(db:DatabaseSync,worldId:string):Index{
 if(!present(db))return index([],worldId);
 const rows=db.prepare('SELECT world_id,schema_version,CASE WHEN length(CAST(operations_json AS BLOB))<=? THEN operations_json ELSE NULL END AS operations_json FROM valley_spirit_life_publications LIMIT 2').all(CAP);
 if(rows.length!==1||rows[0].world_id!==worldId||rows[0].schema_version!==1||typeof rows[0].operations_json!=='string')throw Error('unknown_life_publication_state');
 return index(JSON.parse(rows[0].operations_json),worldId);
}
export function inspectValleySpiritLifePublications(db:DatabaseSync,worldId:string):void {
 if(!WORLD.test(worldId))throw Error('invalid_life_publication_world');
 read(db,worldId);
}
function regular(path:string){
 const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('unsafe_life_publication_database');return s;
}
function same(a:ReturnType<typeof regular>,b:ReturnType<typeof regular>){return a.dev===b.dev&&a.ino===b.ino;}
function prefix(a:readonly Op[],b:readonly Op[]){return b.length>=a.length&&a.every((op,i)=>equal(op,b[i]));}
interface Options {
 readonly mode:'offline-synthetic-life-publication';
 readonly database:string;
 readonly worldId:string;
 readonly assertOwned:()=>void;
 readonly authority:ValleySpiritLifeAuthority;
}
export interface ValleySpiritPublishedLifeView {
 readonly status:'ready';
 readonly generatedBy:'offline-synthetic-selection';
 readonly worldId:string;
 readonly range:Range;
 readonly sectionId:string;
 readonly lines:Section['lines'];
}
/** Trusted, private attachment. Open against a disposable development DB only
 * via an explicit host-side capability. The ordinary world runtime never opens
 * this publisher and there is no network/provider API. */
export class ValleySpiritLifePublisher {
 private readonly db:DatabaseSync;
 private readonly file:ReturnType<typeof regular>;
 private readonly almanac:ValleySpiritLifeAlmanac;
 private seen:readonly Op[];
 private isolated=false;
 constructor(private readonly options:Options){
  if(options.mode!==MODE||!WORLD.test(options.worldId))throw Error('life_publication_disabled');
  options.assertOwned();this.file=regular(options.database);
  const pre=new DatabaseSync(options.database,{readOnly:true});
  try{
   pre.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
   if(!same(this.file,regular(options.database)))throw Error('changed_life_publication_database');
   this.seen=read(pre,options.worldId).ops;
  }finally{pre.close();}
  options.assertOwned();this.db=new DatabaseSync(options.database);
  this.almanac=new ValleySpiritLifeAlmanac(options.authority,'grounded-public-life-dev');
  try{this.db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');this.state();}
  catch(e){this.db.close();throw e;}
 }
 private state(){
  this.options.assertOwned();
  if(!same(this.file,regular(this.options.database)))throw Error('changed_life_publication_database');
  const next=read(this.db,this.options.worldId);
  if(!prefix(this.seen,next.ops))throw Error('rewound_life_publication_database');
  this.seen=next.ops;return next;
 }
 private append(op:Op):boolean{
  let open=false;
  try{
   if(this.isolated)return false;
   this.options.assertOwned();this.db.exec('BEGIN IMMEDIATE');open=true;
   const state=this.state(),next=[...state.ops,op];
   if(next.length>MAX_OPS||(op.phase==='reserved'&&(state.pending.has(op.id)||
    next.length+state.pending.size-state.terminal.size>=MAX_OPS)))return false;
   if(op.phase==='reserved'&&op.correctionOf!==undefined){
    const prior=state.latestByRange.get(key(this.options.worldId,op.packet.range));
    if(!prior||prior.sectionId!==op.correctionOf||sameBasis(prior.packet,op.packet))return false;
   }
   index(next,this.options.worldId);
   // Revalidate again inside publication transaction, immediately before write.
   if(op.phase==='published'&&!this.almanac.read(op.section))return false;
   const json=JSON.stringify(next);
   if(Buffer.byteLength(json)>CAP)return false;
   if(!present(this.db))this.db.exec('CREATE TABLE valley_spirit_life_publications (world_id TEXT PRIMARY KEY NOT NULL,schema_version INTEGER NOT NULL,operations_json TEXT NOT NULL)');
   this.db.prepare('INSERT INTO valley_spirit_life_publications VALUES (?,1,?) ON CONFLICT(world_id) DO UPDATE SET operations_json=excluded.operations_json').run(this.options.worldId,json);
   this.options.assertOwned();this.db.exec('COMMIT');open=false;this.seen=next;return true;
  }catch{this.isolated=true;return false;}
  finally{if(open)try{this.db.exec('ROLLBACK');}catch{this.isolated=true;}}
 }
 publish(range:Range,refs:readonly string[]):'published'|'unavailable'{
  return this.publishVersion(range,refs);
 }
 /** Explicit newly grounded edition of this exact range, not a retry of an
  * unknown send. The prior section may be revoked, but its private identity
  * and range must still be the immediately preceding authoritative edition. */
 correct(range:Range,refs:readonly string[],priorSectionId:string):'published'|'unavailable'{
  if(typeof priorSectionId!=='string'||!/^valley-life-section-[a-f0-9]{64}$/.test(priorSectionId))return 'unavailable';
  return this.publishVersion(range,refs,priorSectionId);
 }
 private publishVersion(range:Range,refs:readonly string[],correctionOf?:string):'published'|'unavailable'{
  if(this.isolated)return 'unavailable';
  const packet=this.almanac.prepare(this.options.worldId,range,refs);
  if(!packet)return 'unavailable';
  const base=key(this.options.worldId,packet.range),menu=menuFor(packet),id=correctionOf?correctionKey(base,correctionOf):base;
  if(!this.append({schemaVersion:1,phase:'reserved',id,packet,menu,...(correctionOf?{correctionOf}:{})}))return 'unavailable';
  if(this.almanac.authorize(packet)){
   const section=this.almanac.ground(packet,syntheticSelect(menu));
   if(section&&this.append({schemaVersion:1,phase:'published',id,section}))return 'published';
  }
  this.append({schemaVersion:1,phase:'suppressed',id});
  return 'unavailable';
 }
 close(){this.db.close();}
}

function currentLatest(state:Index,worldId:string,almanac:ValleySpiritLifeAlmanac):ValleySpiritPublishedLifeView|null {
 // Latest is chosen before authority lookup. Never substitute an older section
 // when the exact latest disclosure cannot be reauthorized.
 const newest=state.ops.filter((o):o is Extract<Op,{phase:'published'}>=>o.phase==='published'&&
   state.latestByRange.get(key(worldId,o.section.packet.range))===o.section).reverse()
  .sort((a,b)=>BigInt(a.section.packet.range.throughUs)>BigInt(b.section.packet.range.throughUs)?-1:
   BigInt(a.section.packet.range.throughUs)<BigInt(b.section.packet.range.throughUs)?1:0)[0];
 if(!newest)return null;
 const substantiated=almanac.read(newest.section);
 return substantiated?Object.freeze({status:'ready',generatedBy:'offline-synthetic-selection',worldId,
  range:Object.freeze({...newest.section.packet.range}),sectionId:substantiated.sectionId,lines:substantiated.lines}):null;
}
/** Reader owns a physically read-only SQLite connection; the HTTP seam accepts
 * only this explicitly provided fixture handle, not the writer or a draft. */
export class ValleySpiritLifeViewer {
 private readonly db:DatabaseSync;
 private readonly file:ReturnType<typeof regular>;
 private readonly almanac:ValleySpiritLifeAlmanac;
 private seen:readonly Op[];
 private isolated=false;
 constructor(private readonly options:Options){
  if(options.mode!==MODE||!WORLD.test(options.worldId))throw Error('life_publication_disabled');
  options.assertOwned();this.file=regular(options.database);this.almanac=new ValleySpiritLifeAlmanac(options.authority,'grounded-public-life-dev');
  this.db=new DatabaseSync(options.database,{readOnly:true});
  try{
   this.db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
   if(!same(this.file,regular(options.database)))throw Error('changed_life_publication_database');
   this.seen=read(this.db,options.worldId).ops;
  }catch(e){this.db.close();throw e;}
 }
 latest(worldId:string):ValleySpiritPublishedLifeView|null {
  if(this.isolated||worldId!==this.options.worldId)return null;
  try{
   this.options.assertOwned();
   if(!same(this.file,regular(this.options.database)))throw Error('changed_life_publication_database');
   const next=read(this.db,worldId);
   if(!prefix(this.seen,next.ops))throw Error('rewound_life_publication_database');
   this.seen=next.ops;
   const latest=currentLatest(next,worldId,this.almanac);
   this.options.assertOwned();return latest;
  }catch{this.isolated=true;return null;}
 }
 close(){this.db.close();}
}
