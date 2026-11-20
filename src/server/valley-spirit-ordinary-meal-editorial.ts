import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {acquireRuntimeOwnership,runtimeOwnershipAnchor,type RuntimeOwnership} from './runtime-lock.js';
import {decodeSavedWorld} from './save-preflight.js';
import {openOrdinaryNativeMealLease} from './valley-spirit-meal-custody.js';
import {openOrdinaryNativeSpeechLease} from './ordinary-native-speech-custody.js';
import {openOrdinaryNativeShelterLease} from './ordinary-native-shelter-custody.js';
import {renderObjectiveNativeHearing,renderObjectiveNativeMeal,renderObjectiveNativeShelter} from './valley-spirit-life-almanac.js';
import {valleySpiritLifeBinding} from './valley-spirit-life-facts.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import type {World} from '../shared/types.js';

export const ORDINARY_NATIVE_MEAL_VIEW='independently-reviewed-native-meal' as const;
export const ORDINARY_NATIVE_HEARING_VIEW='independently-reviewed-native-hearing' as const;
export const ORDINARY_NATIVE_SHELTER_VIEW='independently-reviewed-native-shelter' as const;
const meal=Object.freeze({
 kind:'meal',schema:'ordinary-native-meal-editorial/v1',mode:'explicit-local-ordinary-native-meal-editorial',
 table:'valley_spirit_ordinary_native_meal_editorial',purpose:'local-anonymous-native-meal-no-other-disclosure',view:ORDINARY_NATIVE_MEAL_VIEW,
} as const);
const hearing=Object.freeze({
 kind:'hearing',schema:'ordinary-native-hearing-editorial/v1',mode:'explicit-local-ordinary-native-hearing-editorial',
 table:'valley_spirit_ordinary_native_hearing_editorial',purpose:'local-anonymous-native-hearing-no-other-disclosure',view:ORDINARY_NATIVE_HEARING_VIEW,
} as const);
const shelter=Object.freeze({
 kind:'shelter',schema:'ordinary-native-shelter-editorial/v1',mode:'explicit-local-ordinary-native-shelter-editorial',
 table:'valley_spirit_ordinary_native_shelter_editorial',purpose:'local-anonymous-native-shelter-entry-no-other-disclosure',view:ORDINARY_NATIVE_SHELTER_VIEW,
} as const);
type Profile=typeof meal|typeof hearing|typeof shelter;
const META_DDL='CREATE TABLE archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)';
const MAX=4096;
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const worldId=(v:unknown):v is string=>typeof v==='string'&&/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(v);
const eventId=(v:unknown,w:string):v is string=>typeof v==='string'&&v.startsWith(w+':event:')&&/^[1-9][0-9]{0,15}$/.test(v.slice(w.length+7));
const clock=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&BigInt(v)<=1_000_000_000_000_000n;
const revision=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1;
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v),'utf8').digest('hex');
const termKeys=(profile:Profile)=>['schema','scope','reviewerFingerprint','worldId',selectorKey(profile),'decision','priorVersion','priorDigest','headRevision',
 'headAtUs','headDigest','observedAtUs','witnessDigest','receiptDigest','renderDigest'] as const;
const selectorKey=(profile:Profile)=>profile.kind==='shelter'?'receiptId':'eventId';
const validSelector=(profile:Profile,v:unknown,w:string):v is string=>profile.kind==='shelter'?
 typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v):eventId(v,w);
type Selector<P extends Profile>=P extends typeof shelter?Readonly<{receiptId:string}>:Readonly<{eventId:string}>;

type Config<P extends Profile>=Readonly<{mode:P['mode'];worldId:string;reviewerPublicKeyPem:string;}>&Selector<P>;
export type OrdinaryMealEditorialPin=Config<typeof meal>;
export type OrdinaryHearingEditorialPin=Config<typeof hearing>;
export type OrdinaryShelterEditorialPin=Config<typeof shelter>;
type Pinned<P extends Profile>=Readonly<{worldId:string;reviewer:KeyObject;fingerprint:string;}>&Selector<P>&{readonly __profile?:P['kind']};
const pinProfiles=new WeakMap<object,Profile>();
function pinEditorial<P extends Profile>(profile:P,value:unknown):Pinned<P>|null{
 const key=selectorKey(profile);
 if(!exact(value,['mode','worldId',key,'reviewerPublicKeyPem'])||value.mode!==profile.mode||!worldId(value.worldId)||
  !validSelector(profile,value[key],value.worldId)||typeof value.reviewerPublicKeyPem!=='string'||value.reviewerPublicKeyPem.length>256||
  !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(value.reviewerPublicKeyPem))return null;
 try{
  const reviewer=createPublicKey(value.reviewerPublicKeyPem);
  if(reviewer.asymmetricKeyType!=='ed25519')return null;
  const pin=Object.freeze({worldId:value.worldId,[key]:value[key],reviewer,
   fingerprint:createHash('sha256').update(reviewer.export({type:'spki',format:'der'})).digest('hex')});
  pinProfiles.set(pin,profile);
  return pin as unknown as Pinned<P>;
 }catch{return null;}
}
export const pinOrdinaryMealEditorial=(value:unknown)=>pinEditorial(meal,value);
export const pinOrdinaryHearingEditorial=(value:unknown)=>pinEditorial(hearing,value);
export const pinOrdinaryShelterEditorial=(value:unknown)=>pinEditorial(shelter,value);
type EditorialTerms<P extends Profile> = Readonly<{
 readonly schema:P['schema'];readonly scope:string;readonly reviewerFingerprint:string;readonly worldId:string;
 readonly decision:'publish'|'revoke';readonly priorVersion:0|1;readonly priorDigest:string;readonly headRevision:number;
 readonly headAtUs:string;readonly headDigest:string;readonly observedAtUs:string;readonly witnessDigest:string;
 readonly receiptDigest:string;readonly renderDigest:string;
}>&Selector<P>;
export type OrdinaryMealEditorialTerms=EditorialTerms<typeof meal>;
export type OrdinaryHearingEditorialTerms=EditorialTerms<typeof hearing>;
export type OrdinaryShelterEditorialTerms=EditorialTerms<typeof shelter>;
function encodeEditorial(profile:Profile,t:unknown):Buffer|null{
 const keys=termKeys(profile);
 if(!exact(t,keys)||t.schema!==profile.schema||!worldId(t.worldId)||!validSelector(profile,t[selectorKey(profile)],t.worldId)||
  !(t.decision==='publish'&&t.priorVersion===0||t.decision==='revoke'&&t.priorVersion===1)||
  !revision(t.headRevision)||!clock(t.headAtUs)||!clock(t.observedAtUs)||BigInt(t.observedAtUs)>BigInt(t.headAtUs)||
  ![t.scope,t.reviewerFingerprint,t.priorDigest,t.headDigest,t.witnessDigest,t.receiptDigest,t.renderDigest].every(hex))return null;
 return Buffer.from(JSON.stringify([profile.purpose,...keys.map(k=>t[k])]));
}
export const encodeOrdinaryMealEditorialTerms=(t:unknown)=>encodeEditorial(meal,t);
export const encodeOrdinaryHearingEditorialTerms=(t:unknown)=>encodeEditorial(hearing,t);
export const encodeOrdinaryShelterEditorialTerms=(t:unknown)=>encodeEditorial(shelter,t);
type Signed<P extends Profile>=Readonly<{terms:EditorialTerms<P>;signature:string;}>;
type Line<P extends Profile>=NonNullable<ReturnType<P extends typeof meal?typeof renderObjectiveNativeMeal:P extends typeof hearing?typeof renderObjectiveNativeHearing:typeof renderObjectiveNativeShelter>>;
interface ObjectiveLifeView<P extends Profile> {
 readonly status:'ready';readonly generatedBy:P['view'];
 readonly worldId:string;readonly sectionId:string;
 readonly range:Readonly<{fromUs:string;throughUs:string}>;
 readonly lines:readonly [Line<P>];
}

export type OrdinaryNativeMealLifeView=ObjectiveLifeView<typeof meal>;
export type OrdinaryNativeHearingLifeView=ObjectiveLifeView<typeof hearing>;
export type OrdinaryNativeShelterLifeView=ObjectiveLifeView<typeof shelter>;

function openWithOwner<P extends Profile>(profile:P,owner:RuntimeOwnership,pin:Pinned<P>,writable:boolean){
 if(pinProfiles.get(pin)!==profile)throw Error('ordinary_native_editorial_profile');
 const {schema,table:TABLE}=profile,keys=termKeys(profile),key=selectorKey(profile);
 const selection=(value:Selector<P>)=>(value as unknown as Record<typeof key,string>)[key];
 const DDL='CREATE TABLE '+TABLE+' (version INTEGER PRIMARY KEY NOT NULL, body TEXT NOT NULL)';
 const err=(suffix:string)=>Error('ordinary_native_'+profile.kind+'_editorial_'+suffix);
 const actualOwner=runtimeOwnershipAnchor(owner);
 if(!actualOwner)throw err('owner');
 const path=actualOwner.database,file=lstatSync(path,{bigint:true});
 const guard=()=>{
  actualOwner.assertOwned();
  const s=lstatSync(path,{bigint:true});
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.dev!==file.dev||s.ino!==file.ino)
   throw err('file');
 };
 guard();
 const {worldId,reviewer,fingerprint}=pin,selected=selection(pin);
 const scope=digest([schema,worldId,String(file.dev),String(file.ino),fingerprint]);
 const native=profile.kind==='meal'?openOrdinaryNativeMealLease(owner,path,{scope:'ordinary-native-meal-custody/v1',worldId}):
  profile.kind==='hearing'?openOrdinaryNativeSpeechLease(owner,path,{scope:'ordinary-native-addressed-speech-custody/v1',worldId}):
  openOrdinaryNativeShelterLease(owner,path,{scope:'ordinary-native-shelter-entry-custody/v1',worldId});
 const db=new DatabaseSync(path,{readOnly:!writable});
 try{db.exec(writable?'PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL':'PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');}
 catch(e){db.close();throw e;}
 let closed=false,isolated=false,seen:string[]=[];
 const signed=(x:unknown):Signed<P>|null=>{
  if(!exact(x,['terms','signature'])||typeof x.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(x.signature))return null;
  const bytes=encodeEditorial(profile,x.terms),t=x.terms as EditorialTerms<P>,s=Buffer.from(x.signature,'base64url');
  return bytes&&s.length===64&&s.toString('base64url')===x.signature&&scope===t.scope&&t.reviewerFingerprint===fingerprint&&
   t.worldId===worldId&&selection(t)===selected&&verify(null,bytes,reviewer,s)?{terms:Object.fromEntries(keys.map(k=>[k,(t as unknown as Record<string,unknown>)[k]])) as unknown as EditorialTerms<P>,signature:x.signature}:null;
 };
 const sameSource=(a:EditorialTerms<P>,b:EditorialTerms<P>)=>
  a.witnessDigest===b.witnessDigest&&a.receiptDigest===b.receiptDigest&&a.renderDigest===b.renderDigest&&a.observedAtUs===b.observedAtUs;
 function shapes(){
  if(db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(name)='mvp_spirit_developer_fixture'").get()||
   db.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) IN (?, 'archive_meta','worlds','events','event_people','event_animals') OR type='trigger' AND lower(tbl_name) IN (?,'archive_meta')").get(TABLE,TABLE))
   throw err('scope');
  const m=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)='archive_meta'").get();
  if(m?.name!=='archive_meta'||m.type!=='table'||m.sql!==META_DDL)throw err('meta');
  const t=db.prepare('SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)=?').get(TABLE);
  if((t&&(t.name!==TABLE||t.type!=='table'||t.sql!==DDL))||
   db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name) IN (?, 'archive_meta') AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(TABLE))
   throw err('schema');
  return !!t;
 }
 function readLog(){
  const present=shapes();
  const marker=db.prepare('SELECT value FROM main.archive_meta WHERE key=?').get(schema)?.value;
  if(!present&&marker===undefined&&!seen.length)return {present,body:[] as string[],entries:[] as Signed<P>[],marker:undefined};
  if(!present||!hex(marker))throw err('marker');
  const rows=db.prepare(`SELECT version,CASE WHEN length(CAST(body AS BLOB))<=? THEN body END AS body FROM main.${TABLE} ORDER BY version LIMIT 3`).all(MAX);
  if(!rows.length||rows.length>2||rows.length<seen.length)throw err('count');
  const body:string[]=[],entries:Signed<P>[]=[];
  for(const [i,r] of rows.entries()){
   if(r.version!==i+1||typeof r.body!=='string'||i<seen.length&&r.body!==seen[i])throw err('sequence');
   const x=signed(JSON.parse(r.body)),prev=entries.at(-1)?.terms;
   if(!x||r.body!==JSON.stringify(x)||x.terms.priorVersion!==i||x.terms.priorDigest!==digest(body)||
    prev&&(!sameSource(prev,x.terms)||prev.headRevision>x.terms.headRevision||BigInt(prev.headAtUs)>BigInt(x.terms.headAtUs)||
     prev.headRevision===x.terms.headRevision&&(prev.headAtUs!==x.terms.headAtUs||prev.headDigest!==x.terms.headDigest)))
    throw err('log');
   body.push(r.body);entries.push(x);
  }
  if(marker!==digest([scope,body]))throw err('marker');
  return {present,body,entries,marker};
 }
 function current(){
  const rows=db.prepare('SELECT id,revision,state FROM main.worlds LIMIT 2').all();
  const h=rows[0];
  if(rows.length!==1||h.id!==worldId||!(h.state instanceof Uint8Array)||!revision(h.revision))return null;
  const world=decodeSavedWorld(h.state) as unknown as World;
  if(world.id!==worldId||world.revision!==h.revision||world.mode!=='validation'||Object.hasOwn(world,'simulationOnly')||
   Object.hasOwn(world,'mvpSeasonalModelVersion'))return null;
  const atUs=minuteToClimateUs(world.minute);
  return clock(atUs)?{world,atUs,headDigest:createHash('sha256').update(h.state).digest('hex')}:null;
 }
 function state(){
  const log=readLog(),head=current();
  if(!head)return {log,native:null};
  const proof=native.readEditorialSourceAtHead(db,head.world,selected);
  const line=proof&&(profile.kind==='meal'?renderObjectiveNativeMeal(proof.receipt.atUs):profile.kind==='hearing'?
   renderObjectiveNativeHearing(proof.receipt.atUs):renderObjectiveNativeShelter(proof.receipt.atUs)) as Line<P>|null;
  if(!proof||!line)return {log,native:null};
  const receiptDigest='receiptDigest' in proof?proof.receiptDigest:valleySpiritLifeBinding(proof.receipt).receiptDigest;
  return {log,native:{head,proof,line,basis:{witnessDigest:proof.witnessDigest,receiptDigest,
   observedAtUs:proof.receipt.atUs,renderDigest:digest(line)}}};
 }
 function propose(s:ReturnType<typeof state>,decision:'publish'|'revoke'):EditorialTerms<P>|null{
  if(!s.native||!(decision==='publish'&&s.log.body.length===0||decision==='revoke'&&s.log.body.length===1))return null;
  const {head,basis}=s.native,prior=s.log.entries[0]?.terms;
  const terms={schema,scope,reviewerFingerprint:fingerprint,worldId,[key]:selected,decision,priorVersion:decision==='publish'?0 as const:1 as const,
   priorDigest:digest(s.log.body),headRevision:head.world.revision,headAtUs:head.atUs,headDigest:head.headDigest,
   observedAtUs:basis.observedAtUs,witnessDigest:basis.witnessDigest,receiptDigest:basis.receiptDigest,renderDigest:basis.renderDigest} as unknown as EditorialTerms<P>;
  return prior&&(!sameSource(prior,terms)||prior.headRevision>terms.headRevision||BigInt(prior.headAtUs)>BigInt(terms.headAtUs)||
   prior.headRevision===terms.headRevision&&(prior.headAtUs!==terms.headAtUs||prior.headDigest!==terms.headDigest))?null:terms;
 }
 function transaction<T>(write:boolean,run:(s:ReturnType<typeof state>)=>{value:T;after?:string[]}):T|null{
  if(closed||isolated||write&&!writable)return null;
  let begun=false;
  try{
   guard();db.exec(write?'BEGIN IMMEDIATE':'BEGIN');begun=true;
   const s=state(),r=run(s);
   guard();db.exec('COMMIT');begun=false;seen=r.after??s.log.body;return r.value;
  }catch{
   isolated=true;
   if(begun)try{db.exec('ROLLBACK');}catch{/* isolate */}
   return null;
  }
 }
 return Object.freeze({
  preview(decision:'publish'|'revoke'){
   return transaction(false,s=>{const terms=propose(s,decision);return {value:terms&&s.native?{terms:Object.freeze(terms),line:s.native.line}:null};});
  },
  apply(input:unknown){
   let copy:unknown;
   try{copy=structuredClone(input);}catch{return null;}
   return transaction(true,s=>{
    const a=signed(copy),expected=a?propose(s,a.terms.decision):null;
    if(!a||!expected||!encodeEditorial(profile,expected)?.equals(encodeEditorial(profile,a.terms)!))return {value:null};
    const body=JSON.stringify({terms:expected,signature:a.signature});
    if(Buffer.byteLength(body)>MAX)return {value:null};
    if(!s.log.present)db.exec(DDL);
    const version=expected.priorVersion+1,after=[...s.log.body,body],marker=digest([scope,after]);
    if(db.prepare(`INSERT INTO main.${TABLE} VALUES (?,?)`).run(version,body).changes!==1)
     throw err('append');
    const set=s.log.marker===undefined?db.prepare('INSERT INTO main.archive_meta(key,value) VALUES (?,?)').run(schema,marker):
     db.prepare('UPDATE main.archive_meta SET value=? WHERE key=? AND value=?').run(marker,schema,s.log.marker);
    if(set.changes!==1)throw err('anchor');
    const confirmed=state();
    if(!confirmed.native||confirmed.native.head.world.revision!==expected.headRevision||confirmed.native.head.headDigest!==expected.headDigest||
     confirmed.native.head.atUs!==expected.headAtUs||!sameSource(expected,{...expected,...confirmed.native.basis})||
     JSON.stringify(confirmed.log.body)!==JSON.stringify(after))throw err('readback');
    return {value:Object.freeze({status:expected.decision==='publish'?'published' as const:'revoked' as const}),after};
   });
  },
  latest(id:string,expectedHead:Pick<World,'id'|'revision'|'minute'>):ObjectiveLifeView<P>|null{
   if(id!==worldId||expectedHead.id!==worldId)return null;
   return transaction(false,s=>{
    const p=s.log.entries[0]?.terms,n=s.native;
    if(s.log.entries.length!==1||!p||!n||n.head.world.revision!==expectedHead.revision||n.head.world.minute!==expectedHead.minute||
     n.head.world.revision<p.headRevision||BigInt(n.head.atUs)<BigInt(p.headAtUs)||
     n.head.world.revision===p.headRevision&&n.head.headDigest!==p.headDigest||
     !sameSource(p,{...p,...n.basis}))return {value:null};
    const range=Object.freeze({fromUs:n.line.atUs,throughUs:n.line.atUs});
    const sectionId='valley-life-section-'+digest([schema,scope,digest(s.log.body),n.basis.renderDigest]);
    return {value:Object.freeze({status:'ready' as const,generatedBy:profile.view,
     worldId,sectionId,range,lines:Object.freeze([n.line] as const)})};
   });
  },
  close(){if(!closed){closed=true;db.close();}}
 });
}

/** Stopped trusted owner config; no HTTP/CLI writer and no private key inside
 * this seam. The caller is responsible for pinning its independent reviewer. */
function openEditor<P extends Profile>(profile:P,database:string,options:Config<P>){
 const pin=pinEditorial(profile,options);
 if(!pin)throw Error('ordinary_native_'+profile.kind+'_editorial_pin');
 const owner=acquireRuntimeOwnership(database,{existingOnly:true});
 try{
  const editor=openWithOwner(profile,owner,pin,true);
  return Object.freeze({
   preview:editor.preview,apply:editor.apply,
   close(){try{editor.close();}finally{owner.release();}},
  });
 }catch(e){owner.release();throw e;}
}
export const openOrdinaryMealEditorial=(database:string,options:OrdinaryMealEditorialPin)=>openEditor(meal,database,options);
export const openOrdinaryHearingEditorial=(database:string,options:OrdinaryHearingEditorialPin)=>openEditor(hearing,database,options);
export const openOrdinaryShelterEditorial=(database:string,options:OrdinaryShelterEditorialPin)=>openEditor(shelter,database,options);
/** Borrow runtime ownership on a physically read-only SQLite connection. */
function openViewer<P extends Profile>(profile:P,owner:RuntimeOwnership,pin:Pinned<P>,head:()=>World){
 const reader=openWithOwner(profile,owner,pin,false);
 return Object.freeze({latest:(id:string)=>reader.latest(id,head()),close:reader.close});
}
export const openOrdinaryMealEditorialViewer=(owner:RuntimeOwnership,pin:Pinned<typeof meal>,head:()=>World)=>openViewer(meal,owner,pin,head);
export const openOrdinaryHearingEditorialViewer=(owner:RuntimeOwnership,pin:Pinned<typeof hearing>,head:()=>World)=>openViewer(hearing,owner,pin,head);

export const openOrdinaryShelterEditorialViewer=(owner:RuntimeOwnership,pin:Pinned<typeof shelter>,head:()=>World)=>openViewer(shelter,owner,pin,head);
