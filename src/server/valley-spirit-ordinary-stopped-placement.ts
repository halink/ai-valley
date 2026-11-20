import {assertStoppedEventArchive,assertStoppedEventAuthority,prepareStoppedGroundReplayMinute,recoverStoppedGroundContinuation,stoppedContinuationSql,stoppedContinuationTable,stoppedGroundBody,type StoppedGroundReplay} from './valley-spirit-ordinary-stopped-continuation.js';
import {createHash,createHmac,createPublicKey,randomBytes,verify} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {constants,fstatSync,lstatSync,mkdtempSync,openSync,closeSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import {gzipSync} from 'node:zlib';
import type {World,WorldEvent} from '../shared/types.js';
import {parseClimateUs} from '../world/mvp-climate.js';
import {resolveMvpRainEpisode} from '../world/mvp-rain-provenance.js';
import {validateMvpGroundFruitState} from '../world/mvp-ground-fruit.js';
import {decodeSavedWorld} from './save-preflight.js';
import {acquireRuntimeOwnership,type RuntimeOwnership} from './runtime-lock.js';
import {SqliteValleySpiritPermissions,readValleySpiritWeatherPermission} from './valley-spirit-permissions.js';
import {publicWeatherProjection,ValleySpiritJournal} from './valley-spirit.js';
import {openRulesGeographyQueue,pinRulesGeographyQueue,type RulesGeographyQueueOptions} from './valley-spirit-rules-geography-queue.js';
import {inspectRulesAgedFruitBasis} from './valley-spirit-rules-aged-preflight.js';
import {pinRulesNativeFruitRenewal,readRulesNativeFruitLot,type RulesNativeFruitRenewalPin} from './valley-spirit-rules-fruit-renewal.js';
import {pinOrdinaryAgedGround,readOwnedEmptyGround,type OrdinaryAgedGroundPin,type AgedGroundLot} from './valley-spirit-ordinary-aged-ground.js';
import {prepareOrdinaryAgedG1ReviewEncoding,pinOrdinaryAgedG1Review,ordinaryAgedG1ReviewSigningBytes,type OrdinaryAgedG1ReviewOptions} from './valley-spirit-ordinary-aged-g1-review.js';

const prefix='valley-ordinary-stop-',purpose='ordinary-stopped-g2-placement-only/v1';
const table='valley_spirit_ordinary_aged_transfer',groundTable='valley_spirit_ordinary_aged_ground';
const ddl='CREATE TABLE valley_spirit_ordinary_aged_transfer(slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1),body TEXT NOT NULL,prior BLOB NOT NULL,mac TEXT NOT NULL)';
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/u.test(v);
const hash=(x:string|Uint8Array)=>createHash('sha256').update(x).digest('hex');
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const exact=(x:unknown,k:readonly string[]):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===k.length&&k.every(v=>Object.hasOwn(x,v));
const ino=(path:string)=>{const s=lstatSync(path,{bigint:true});return {stat:s,id:s.dev+':'+s.ino};};
const root=()=>realpathSync(tmpdir());
function bad():never{throw Error('ordinary_stopped_placement_rejected');}
export interface StoppedPlacementOptions {
 readonly queue:RulesGeographyQueueOptions;readonly renewal:RulesNativeFruitRenewalPin;
 readonly ground:OrdinaryAgedGroundPin;readonly review:OrdinaryAgedG1ReviewOptions;readonly g2PublicKeyPem:string;
}
function pin(v:unknown){
 if(!exact(v,['queue','renewal','ground','review','g2PublicKeyPem']))return bad();
 const q=pinRulesGeographyQueue(v.queue),n=pinRulesNativeFruitRenewal(v.renewal),g=pinOrdinaryAgedGround(v.ground),
  review=pinOrdinaryAgedG1Review(v.review);
 if(!q||!n?.lotShelfLifeGameMinutes||!g||!review||q.worldId!==n.worldId||q.worldId!==g.worldId||
  q.site.sourceId!==n.sourceId||q.site.sourceId!==g.sourceId||q.site.target.x!==g.target.x||q.site.target.y!==g.target.y||
  typeof v.g2PublicKeyPem!=='string'||v.g2PublicKeyPem.length>256||
  !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/u.test(v.g2PublicKeyPem))return bad();
 const key=createPublicKey(v.g2PublicKeyPem),keyId=hash(key.export({type:'spki',format:'der'}));
 if(key.asymmetricKeyType!=='ed25519'||keyId===review.keyId)return bad();
 const options=Object.freeze({queue:q,renewal:n,ground:g,review:Object.freeze({...v.review as OrdinaryAgedG1ReviewOptions}),g2PublicKeyPem:v.g2PublicKeyPem});
 return {options,review,key,keyId};
}
export interface StoppedPlacementKey {readonly directory:string;readonly token:string}
const localFile=(f:ReturnType<typeof ino>['stat'])=>f.isFile()&&f.uid===BigInt(process.getuid!())&&f.nlink===1n&&(f.mode&0o077n)===0n;
export function createStoppedOrdinaryPlacementSave(options:StoppedPlacementOptions){
 const p=pin(options),directory=mkdtempSync(join(root(),prefix)),database=join(directory,'placement.sqlite');
 closeSync(openSync(database,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600));
 const token=randomBytes(32).toString('hex');
 const manifest={purpose,directoryId:ino(directory).id,databaseId:ino(database).id,options:p.options};
 const body=JSON.stringify(manifest);
 writeFileSync(join(directory,'placement-owner.json'),JSON.stringify({body,mac:mac(token,body)}),{flag:'wx',mode:0o600});
 return Object.freeze({database,key:Object.freeze({directory,token})});
}
const mac=(token:string,body:string,prior?:Uint8Array)=>createHmac('sha256',Buffer.from(token,'hex')).update(body).update(prior??'').digest('hex');
function owned(key:StoppedPlacementKey){
 if(!exact(key,['directory','token'])||!hex(key.token)||typeof key.directory!=='string'||dirname(key.directory)!==root()||
  !/^valley-ordinary-stop-[A-Za-z0-9]{6}$/u.test(basename(key.directory)))return bad();
 const dir=ino(key.directory),file=join(key.directory,'placement.sqlite'),manifest=join(key.directory,'placement-owner.json');
 const db=ino(file),m=ino(manifest);
 if(!dir.stat.isDirectory()||dir.stat.uid!==BigInt(process.getuid!())||(dir.stat.mode&0o777n)!==0o700n||
  !localFile(m.stat)||m.stat.size>8192n||!localFile(db.stat))return bad();
 const readManifest=()=>{
  const fd=openSync(manifest,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const f=fstatSync(fd,{bigint:true});
   if(!localFile(f)||f.dev!==m.stat.dev||f.ino!==m.stat.ino||f.size!==m.stat.size||f.ctimeNs!==m.stat.ctimeNs)return bad();
   const text=readFileSync(fd,'utf8');
   if(fstatSync(fd,{bigint:true}).ctimeNs!==f.ctimeNs||Buffer.byteLength(text)>8192)return bad();
   return text;
  }finally{closeSync(fd);}
 };
 const blob=readManifest();
 if(ino(manifest).id!==m.id||ino(file).id!==db.id||ino(key.directory).id!==dir.id||Buffer.byteLength(blob)>8192)return bad();
 const raw:unknown=JSON.parse(blob);
 if(!exact(raw,['body','mac'])||typeof raw.body!=='string'||raw.mac!==mac(key.token,raw.body))return bad();
 const v:unknown=JSON.parse(raw.body);
 if(!exact(v,['purpose','directoryId','databaseId','options'])||v.purpose!==purpose||v.directoryId!==dir.id||v.databaseId!==db.id)return bad();
 const p=pin(v.options),owner=acquireRuntimeOwnership(file,{existingOnly:true});
 try{
  const assert=()=>{owner.assertOwned();if(ino(file).id!==db.id||ino(key.directory).id!==dir.id||readManifest()!==blob)bad();};
  assert();return {owner,assert,p};
 }catch(e){owner.release();throw e;}
}
const fields=['purpose','worldId','revision','atUs','untilUs','g1Digest','beforeDigest','reviewerKeyId','effectKeyId','lotId','targetId'] as const;
export function stoppedOrdinaryPlacementSigningBytes(v:unknown):Buffer|null {
 try{
  if(!exact(v,fields)||v.purpose!==purpose||typeof v.worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/u.test(v.worldId)||
   !integer(v.revision)||!['g1Digest','beforeDigest','reviewerKeyId','effectKeyId'].every(k=>hex(v[k]))||v.reviewerKeyId===v.effectKeyId||
   typeof v.lotId!=='string'||!/^native-fruit:[a-f0-9]{64}$/u.test(v.lotId)||
   typeof v.targetId!=='string'||!/^ground:\d{1,4}:\d{1,4}$/u.test(v.targetId)||typeof v.atUs!=='string'||typeof v.untilUs!=='string'||
   parseClimateUs(v.untilUs)<=parseClimateUs(v.atUs)||parseClimateUs(v.untilUs)-parseClimateUs(v.atUs)>60_000_000n)return null;
  return Buffer.from(JSON.stringify(fields.map(k=>v[k])));
 }catch{return null;}
}
function signedKey(expected:unknown,signed:unknown,p:ReturnType<typeof pin>){
 try{
  if(!exact(signed,['terms','signature'])||typeof signed.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/u.test(signed.signature))return false;
  const a=stoppedOrdinaryPlacementSigningBytes(expected),b=stoppedOrdinaryPlacementSigningBytes(signed.terms);
  const sig=Buffer.from(signed.signature,'base64url');
  return !!a&&!!b&&a.equals(b)&&sig.length===64&&sig.toString('base64url')===signed.signature&&verify(null,a,p.key,sig);
 }catch{return false;}
}
function authority(db:DatabaseSync){
 const names=['worlds',groundTable,table,'valley_spirit_rules_native_fruit_renewal','valley_spirit_permissions'];
 const qm=names.map(()=>'?').join(',');
 if(db.prepare(`SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN (${qm}) OR lower(tbl_name) IN (${qm})`).get(...names,...names)||
  db.prepare(`SELECT 1 FROM sqlite_schema WHERE type='trigger' AND lower(tbl_name) IN (${qm})`).get(...names))return bad();
 const worlds=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='worlds' COLLATE NOCASE").get();
 if(worlds?.type!=='table'||worlds.sql!=='CREATE TABLE worlds (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state BLOB NOT NULL)'||
  db.prepare("SELECT 1 FROM sqlite_schema WHERE type='index' AND lower(tbl_name)='worlds' AND sql IS NOT NULL").get())return bad();
 const ground=db.prepare('SELECT type,sql FROM sqlite_schema WHERE lower(name)=?').get(groundTable);
 if(ground?.type!=='table'||ground.sql!=='CREATE TABLE valley_spirit_ordinary_aged_ground(slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1),body TEXT NOT NULL,digest TEXT NOT NULL)'||
  db.prepare("SELECT 1 FROM sqlite_schema WHERE type='index' AND lower(tbl_name)=?").get(groundTable))return bad();
 const t=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE').get(table);
 if(t&&(t.type!=='table'||t.sql!==ddl||db.prepare('SELECT 1 FROM sqlite_schema WHERE type=\'index\' AND lower(tbl_name)=?').get(table)))return bad();
 return !!t;
}
function head(db:DatabaseSync){
 const rows=db.prepare('SELECT id,revision,CASE WHEN length(CAST(state AS BLOB))<=33554432 THEN state END AS state FROM main.worlds LIMIT 2').all();
 const r=rows[0];if(rows.length!==1||!(r.state instanceof Uint8Array)||!integer(r.revision))return bad();
 const w=decodeSavedWorld(r.state) as unknown as World;
 if(w.id!==r.id||w.revision!==r.revision||w.mode!=='validation'||!w.mvpClimate?.rainProvenance||w.clock.paused||
  Object.hasOwn(w,'simulationOnly')||Object.hasOwn(w.mvpClimate,'spiritEffects')||Object.hasOwn(w.mvpClimate,'spiritFruitSettlement')||
  !gzipSync(JSON.stringify(w),{level:1}).equals(r.state))return bad();
 return {w,bytes:r.state};
}
function currentBasis(db:DatabaseSync,owner:RuntimeOwnership,p:ReturnType<typeof pin>,w:World,g1:unknown,before:Uint8Array){
 const n=p.options;
 if(w.id!==n.queue.worldId)return null;
 const lot=readRulesNativeFruitLot(db,n.renewal,w),ground=readOwnedEmptyGround(db,owner,n.ground,w),
  permission=readValleySpiritWeatherPermission(db,w.id),weather=publicWeatherProjection(w);
 if(!lot||!ground||!permission?.publicWeather||!weather)return null;
 const permissions=new SqliteValleySpiritPermissions(owner.database,w.id,owner.assertOwned,true);
 try{
  const journal=new ValleySpiritJournal(owner.database,weather,owner.assertOwned,permissions);
  const queue=openRulesGeographyQueue(owner.database,n.queue,journal,owner.assertOwned,()=>w);
  const reviewed=queue.review(w);
  if(reviewed.status!=='geography_only'||reviewed.recordedProposal.permissionVersion!==permission.version)return null;
  const basis=inspectRulesAgedFruitBasis(w,n.queue,reviewed,lot);
  const g1Result=prepareOrdinaryAgedG1ReviewEncoding(p.review,basis,ground,g1);
  if(basis.status!=='blocked'||g1Result.status!=='encoding-only'||g1===undefined)return null;
  const terms=Object.freeze({purpose,worldId:w.id,revision:w.revision,atUs:g1Result.terms.atUs,untilUs:g1Result.terms.untilUs,
   g1Digest:hash(JSON.stringify([g1Result.terms,(g1 as {signature:string}).signature])),
   beforeDigest:hash(before),reviewerKeyId:p.review.keyId,effectKeyId:p.keyId,lotId:lot.lot.id,targetId:ground.targetId});
  return stoppedOrdinaryPlacementSigningBytes(terms)?{terms,basis,ground,g1:{terms:g1Result.terms,signature:(g1 as {signature:string}).signature}}:null;
 }finally{permissions.close();}
}
type Basis=NonNullable<ReturnType<typeof currentBasis>>;
function transfer(w:World,b:Basis){
 const source=w.resources.filter(r=>r.id===b.basis.sourceResourceInstanceId.replace(/^mvp-fruit:|:[0-9]+:[0-9]+$/gu,''));
 if(source.length!==1||source[0].kind!=='bush'||source[0].foodItem!=='fruit'||source[0].amount<1||
  !resolveMvpRainEpisode(w,b.basis.rainEventId))return bad();
 const s=source[0],after=structuredClone(w);
 const effectId='ordinary-stopped:'+hash(JSON.stringify(b.terms));
 const ground:AgedGroundLot={fruit:{effectId,kind:'fallen-fruit',amount:1,ownerId:'commons',sourceResourceId:s.id,
  sourceResourceInstanceId:b.basis.sourceResourceInstanceId,sourceAt:{...s.at},rainEventId:b.basis.rainEventId,
  at:{x:Number(b.terms.targetId.split(':')[1]),y:Number(b.terms.targetId.split(':')[2])},placedUs:b.terms.atUs},
  bornUs:b.basis.sourceLot.bornUs,expiresUs:b.basis.sourceLot.expiresUs};
 validateMvpGroundFruitState(w,{version:1,items:[ground.fruit]});
 after.resources.find(r=>r.id===s.id)!.amount--;
 if(!Number.isSafeInteger(++after.revision))return bad();
 const groundState=JSON.stringify({version:2,worldId:w.id,effectId,items:[ground]});
 return {after,groundState,ground,receipt:Object.freeze({effectId,sourceDebit:1 as const,groundCredit:1 as const,
  bornUs:ground.bornUs,expiresUs:ground.expiresUs,revision:after.revision,productionEnabled:false as const})};
}
const rawGround=(db:DatabaseSync)=>db.prepare('SELECT body,digest FROM main.valley_spirit_ordinary_aged_ground WHERE slot=1').get();
function recover(db:DatabaseSync,key:StoppedPlacementKey,p:ReturnType<typeof pin>,live:ReturnType<typeof head>){
 const rows=db.prepare(`SELECT CASE WHEN length(CAST(body AS BLOB))<=16384 THEN body END AS body,
  CASE WHEN length(prior)<=33554432 THEN prior END AS prior,mac FROM main.${table} LIMIT 2`).all();
 const row=rows[0];
 if(rows.length!==1||typeof row.body!=='string'||!(row.prior instanceof Uint8Array)||row.mac!==mac(key.token,row.body,row.prior))return bad();
 const v=JSON.parse(row.body) as {b:Basis;g2:unknown};
 if(!exact(v,['b','g2'])||!v.b||!signedKey(v.b.terms,v.g2,p)||v.b.terms.beforeDigest!==hash(row.prior))return bad();
 const b=v.b,prior=decodeSavedWorld(row.prior) as unknown as World;
 const checked=prepareOrdinaryAgedG1ReviewEncoding(p.review,b.basis,b.ground,b.g1);
 if(checked.status!=='encoding-only'||checked.terms.reviewerKeyId!==p.review.keyId||b.terms.reviewerKeyId!==p.review.keyId||
  b.terms.effectKeyId!==p.keyId||b.terms.g1Digest!==hash(JSON.stringify([checked.terms,b.g1.signature]))||
  b.terms.worldId!==checked.terms.worldId||b.terms.revision!==checked.terms.revision||b.terms.atUs!==checked.terms.atUs||
  b.terms.untilUs!==checked.terms.untilUs||b.terms.lotId!==checked.sourceLotId||b.terms.targetId!==checked.targetId||
  prior.id!==b.terms.worldId||prior.revision!==b.terms.revision||prior.mvpClimate?.lastUs!==b.terms.atUs||
  prior.id!==p.options.queue.worldId||b.basis.sourceResourceInstanceId!==b.ground.sourceResourceInstanceId||
  b.terms.targetId!=='ground:'+p.options.ground.target.x+':'+p.options.ground.target.y)return bad();
 const {after,ground,receipt}=transfer(prior,v.b),raw=rawGround(db);
 const replay=recoverStoppedGroundContinuation(db,after,ground,hash(row.body),live.bytes,raw);
 return {receipt,b:v.b,g2:v.g2,replay};
}
/** Single write followed by immutable private recovery only. Ordinary runtime
 * refuses the archive; there is no route, scheduler, or new resident action. */
export function stoppedOrdinaryPlacement(key:StoppedPlacementKey,request:Readonly<{g1?:unknown;g2?:unknown;fault?:'after-source-cas'}>={}){
 try{
  const {owner,assert,p}=owned(key);
  try{
   const db=new DatabaseSync(owner.database);
   try{
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
    const exists=authority(db),live=head(db);
    if(exists){
     const r=recover(db,key,p,live);
     if(request.g1===undefined&&request.g2===undefined)return {status:'recovered' as const,replay:true,receipt:r.receipt};
     return exact(request.g1,['terms','signature'])&&request.g1.signature===r.b.g1.signature&&
      ordinaryAgedG1ReviewSigningBytes(request.g1.terms)?.equals(ordinaryAgedG1ReviewSigningBytes(r.b.g1.terms)!)&&
      signedKey(r.b.terms,request.g2,p)?{status:r.replay.sequence?'historical-placement' as const:'placed' as const,replay:true,receipt:r.receipt}:null;
    }
    if(db.prepare('SELECT 1 FROM sqlite_schema WHERE name=? COLLATE NOCASE').get(stoppedContinuationTable)||request.g1===undefined)return null;
    const b=currentBasis(db,owner,p,live.w,request.g1,live.bytes);
    if(!b)return null;
    if(request.g2===undefined)return {status:'g2-signing-input' as const,terms:b.terms,executionAuthorized:false as const};
    if(!signedKey(b.terms,request.g2,p)||request.fault!==undefined&&request.fault!=='after-source-cas')return null;
    const next=transfer(live.w,b),bytes=gzipSync(JSON.stringify(next.after),{level:1}),empty=rawGround(db);
    const body=JSON.stringify({b,g2:{terms:b.terms,signature:(request.g2 as {signature:string}).signature}});
    if(!empty||typeof empty.body!=='string'||Buffer.byteLength(body)>16384)return bad();
    if(db.prepare('UPDATE main.worlds SET revision=?,state=? WHERE id=? AND revision=? AND state=?')
      .run(next.after.revision,bytes,live.w.id,live.w.revision,live.bytes).changes!==1)return bad();
    if(request.fault==='after-source-cas')return bad();
    if(db.prepare('UPDATE main.valley_spirit_ordinary_aged_ground SET body=?,digest=? WHERE slot=1 AND body=? AND digest=?')
      .run(next.groundState,hash(next.groundState),empty.body,empty.digest).changes!==1)return bad();
    db.exec(ddl);
    db.prepare(`INSERT INTO main.${table} VALUES(1,?,?,?)`).run(body,live.bytes,mac(key.token,body,live.bytes));
    if(JSON.stringify(recover(db,key,p,head(db)).receipt)!==JSON.stringify(next.receipt))return bad();
    assert();db.exec('COMMIT');return {status:'placed' as const,replay:false,receipt:next.receipt};
   }finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}
  }finally{owner.release();}
 }catch{return null;}
}

function append(db:DatabaseSync,w:World,events:readonly WorldEvent[]){
 for(const e of events){
  const body=JSON.stringify(e);
  if(Buffer.byteLength(body)>131072)bad();
  const seq=db.prepare('INSERT INTO main.events (id,world_id,at,body) VALUES (?,?,?,?)').run(e.id,w.id,e.at,body).lastInsertRowid;
  for(const id of new Set(e.actors))db.prepare('INSERT INTO main.event_people VALUES (?,?,?,?)').run(w.id,id,e.id,seq);
  for(const id of new Set(e.animalIds??[]))db.prepare('INSERT INTO main.event_animals VALUES (?,?,?,?)').run(w.id,id,e.id,seq);
 }
}
/** Owning placement path must verify the original dual signed archive first;
 * no generic caller or detached world can reach this function's committing path. */
function stageStoppedGroundMinute(db:DatabaseSync,current:StoppedGroundReplay,old:Uint8Array,failAfterWorld:boolean){
 const draft=prepareStoppedGroundReplayMinute(current);
 if(!draft||!current.lot)return null;
 assertStoppedEventAuthority(db);assertStoppedEventArchive(db,current.world);
 const state=gzipSync(JSON.stringify(draft.finish.world),{level:1}),ground=stoppedGroundBody(draft.finish,current.lot.fruit.effectId),prior=stoppedGroundBody(current,current.lot.fruit.effectId);
 if(state.length>32*1024*1024||db.prepare('UPDATE main.worlds SET revision=?,state=? WHERE id=? AND revision=? AND state=?')
  .run(draft.finish.world.revision,state,current.world.id,current.world.revision,old).changes!==1)bad();
 if(failAfterWorld)bad();
 if(db.prepare('UPDATE main.valley_spirit_ordinary_aged_ground SET body=?,digest=? WHERE slot=1 AND body=? AND digest=?')
  .run(ground,hash(ground),prior,hash(prior)).changes!==1)bad();
 if(!current.sequence)db.exec(stoppedContinuationSql);
 db.prepare(`INSERT INTO main.${stoppedContinuationTable} VALUES (?,?)`).run(draft.finish.sequence,draft.body);
 append(db,draft.finish.world,draft.events);
 return draft.finish;
}

/** One explicit native minute on the exact joined head. Calling this routine
 * does not grant discovery to observers or change the original fruit age. */
export function advanceStoppedOrdinaryGround(key:StoppedPlacementKey,expectedRevision:number,fault?:'after-world-cas'){
 if(!integer(expectedRevision)||fault!==undefined&&fault!=='after-world-cas')return null;
 try{
  const {owner,assert,p}=owned(key);
  try{
   const db=new DatabaseSync(owner.database);
   try{
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    if(!authority(db))return null;
    const live=head(db);
    if(live.w.revision!==expectedRevision)return null;
    const before=recover(db,key,p,live);
    const draft=stageStoppedGroundMinute(db,before.replay,live.bytes,fault==='after-world-cas');
    if(!draft)return null;
    const checked=recover(db,key,p,head(db)).replay;
    if(checked.sequence!==draft.sequence||checked.world.revision!==draft.world.revision)return bad();
    assert();db.exec('COMMIT');
    return Object.freeze({status:checked.expiry?'expired' as const:'advanced' as const,sequence:checked.sequence,
     revision:checked.world.revision,atUs:checked.world.mvpClimate!.lastUs,expiry:checked.expiry,productionEnabled:false as const});
   }finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}
  }finally{owner.release();}
 }catch{return null;}
}
export function readStoppedOrdinaryGroundDiscovery(key:StoppedPlacementKey,residentId:string){
 if(typeof residentId!=='string'||!residentId||residentId.length>200)return null;
 try{
  const {owner,assert,p}=owned(key);
  try{
   const db=new DatabaseSync(owner.database,{readOnly:true});
   try{
    db.exec('PRAGMA trusted_schema=OFF; BEGIN');
    if(!authority(db))return null;
    const discovered=recover(db,key,p,head(db)).replay.discoveries.get(residentId);
    assert();return discovered??null;
   }finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}
  }finally{owner.release();}
 }catch{return null;}
}
