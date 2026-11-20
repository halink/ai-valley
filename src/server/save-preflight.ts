import {stagedOrdinaryDevelopmentV3WorkActor,type prepareOrdinaryDevelopmentV3Minute} from './ordinary-g2-development-v3.js';
import {ownsOrdinaryDevelopmentV3Pin,readOrdinaryDevelopmentV3,type OrdinaryDevelopmentV3Pin} from './ordinary-g2-development-v3.js';
import {assertOrdinaryG2DevelopmentPath,inspectOrdinaryG2DevelopmentOrigin,isOrdinaryG2DevelopmentOriginScratch,type OrdinaryG2DevelopmentOrigin} from './ordinary-g2-development-origin.js';
import {assertDisposableNativeAgedTransferStorage,exactDisposableEating,isDisposableNativeAgedTransferPin,readDisposableNativeAgedTransfer,readExactDisposableActiveEating,type Eating,type DisposableNativeAgedTransferPin} from './disposable-native-aged-transfer.js';
import {assertDisposableRulesSavePath,readDisposableRulesSaveMarker,type DisposableRulesSaveAuthority} from './disposable-native-rules-save.js';
import {assertOrdinaryAgedGroundStartup,type OrdinaryAgedGroundPin} from './valley-spirit-ordinary-aged-ground.js';
import {rejectSealedAgedBirthOnGenericPath} from './valley-spirit-aged-birth-archive.js';
import {assertFormalBerryMirrorHeader} from './valley-spirit-formal-berry-authority.js';
import {validateFormalRainProvenance} from '../world/formal-rain-provenance.js';
import {validateMvpRooms} from '../world/mvp-rooms.js';
import {readSeasonalLedger,type SeasonalLedger} from './seasonal-model-ledger.js';
import {validateSeasonalKnowledge} from '../world/mvp-seasonal-knowledge.js';
import {validateMvpPreservation} from '../world/mvp-preservation.js';
import {validateMvpClimate} from '../world/mvp-climate-state.js';
import {hasMvpSpiritEffects,hasMvpSpiritEffectEvents,validateMvpSpiritEffects} from '../world/mvp-spirit-effects.js';
import {validMvpFallenFruitSettlementLedger} from '../world/mvp-fallen-fruit-settlement.js';
import type {World} from '../shared/types.js';
/** Read-before-write compatibility gate. No migration or model/runtime dependency.
 * The probe reads private copies so SQLite cannot create/change the source SHM.
 * Persistent callers still own the original save via their existing lifetime lock.
 */
import {DatabaseSync} from 'node:sqlite';
import {constants,closeSync,fstatSync,lstatSync,mkdtempSync,openSync,readSync,rmSync,writeSync,type BigIntStats} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';

export class SaveCompatibilityError extends Error {
 constructor(readonly code:string){super(code);this.name='SaveCompatibilityError';}
}
function fail(code:string):never {throw new SaveCompatibilityError(code);}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const owns=(v:object,key:string)=>Object.prototype.hasOwnProperty.call(v,key);
// Exact reserved upgrade names only. Unknown legacy extension names are not
// guessed from prefixes/regex. These modules have no writable format yet.
const unsupportedUpgradeFields=['worldUpgrade','mvpGroundFruit','mvpSpiritEffects','spiritFruitSettlement','mvpSpiritFruitSettlement'] as const;
const MAX_STATE_BYTES=256*1024*1024;

/** Validate only the compatibility envelope, not every game's domain rule. */
export function assertWorldCompatibility(value:unknown,allowMvpSpiritEffectFixture=false):asserts value is Record<string,unknown> {
 return assertWorldCompatibilityInternal(value,allowMvpSpiritEffectFixture);
}
export function assertStagedDisposableEatingCompatibility(value:World,work: Eating):void{
 assertWorldCompatibilityInternal(value,false,work);
}
export function assertStagedOriginalOutdoorCompatibility(db:DatabaseSync,step:NonNullable<ReturnType<typeof prepareOrdinaryDevelopmentV3Minute>>){
 const actor=stagedOrdinaryDevelopmentV3WorkActor(db,step);
 if(!actor)fail('save_ordinary_g2_development_v3');
 assertWorldCompatibilityInternal(step.draft,false,undefined,actor);
}
function assertWorldCompatibilityInternal(value:unknown,allowMvpSpiritEffectFixture:boolean,privateEating?:Eating,originalOutdoorActor?:string):asserts value is Record<string,unknown>{
 if(!record(value))fail('save_invalid_world');
 if(Array.isArray(value.events)&&value.events.some(e=>record(e)&&(owns(e,'mvpAgedFruitBirth')||owns(e,'mvpAgedFruitExpiry')||owns(e,'mvpAgedFruitPickup')||owns(e,'mvpAgedHeldFruitExpiry')||owns(e,'mvpAgedHeldFruitEaten'))))fail('save_sealed_aged_birth_requires_private_archive');
 // Reject presence, not a recognized version/truthy value. No upgrade escape.
 if(owns(value,'simulationOnly'))fail('save_simulation_only');
 if(owns(value,'mvpSeasonalModelVersion')&&(value.mvpSeasonalModelVersion!==1||value.mode!=='validation'))fail('save_seasonal_model_schema');
 try{validateSeasonalKnowledge(value as unknown as World);}catch{fail('save_invalid_mvpSeasonalKnowledge');}
 // Version 2 is exclusively the offline seasonal ledger format. Old
 // binaries reject it before their schema-1 rule writer can touch the file.
 if(value.schemaVersion===2){
  if(value.mode!=='validation'||value.mvpSeasonalModelVersion!==1)fail('save_seasonal_model_schema');
 }else if(value.schemaVersion===3){
  // Only the already-used shelter rules protocol can own schema 3. The
  // historical root-v1 binary must stop before attempting an unknown action.
  if(value.mode!=='validation'||typeof value.id!=='string'||!value.id.startsWith('godot-mvp-')||owns(value,'mvpSeasonalModelVersion')
   ||!record(value.mvpClimate)||value.mvpClimate.schemaVersion!==3||!record(value.mvpRooms)||value.mvpRooms.version!==1||!record(value.rooms)||!Array.isArray(value.residents))
   fail('save_shelter_schema');
  try{validateMvpRooms(value as unknown as World);}catch{fail('save_shelter_room_state');}
 }else if(value.schemaVersion!==1)fail('save_unsupported_world_schema');
 else if(owns(value,'mvpSeasonalModelVersion'))fail('save_seasonal_model_schema');
 try{validateMvpPreservation(value as unknown as World);}catch{fail('save_invalid_mvpPreservation');}
 if(privateEating&&!exactDisposableEating(value as unknown as World,privateEating))fail('save_disposable_invalid_aged_eating');
 if(Array.isArray(value.residents))for(const r of value.residents){
  if(!record(r))continue;
  const arrangement=record(r.plan)?r.plan:null;
  const plan=arrangement&&Array.isArray(arrangement.actions)?arrangement.actions:[];
  const activity=record(r.activity)?r.activity:null;
  if(plan.some(a=>record(a)&&(a.type==='mvpAgedFruitPickup'||a.type==='mvpAgedFruitEat'))||
   activity&&(owns(activity,'mvpAgedEatWorkStartedAt')&&(!privateEating?.table||privateEating.residentId!==r.id)||record(activity.action)&&(activity.action.type==='mvpAgedFruitPickup'||
    activity.action.type==='mvpAgedFruitEat'&&privateEating?.residentId!==r.id&&originalOutdoorActor!==r.id)))
   fail('save_sealed_aged_pickup_requires_private_archive');
  const pending=plan.some(a=>record(a)&&a.type==='mvpShelter');
  const shelter=activity&&record(activity.action)&&activity.action.type==='mvpShelter';
  if(pending||shelter||activity&&owns(activity,'mvpShelterEnteredAt')){
   if(value.schemaVersion!==3)fail('save_shelter_action_requires_schema');
   if(pending||shelter){
    const at=arrangement?.createdAt,id=arrangement?.id;
    if(!arrangement||arrangement.actorId!==r.id||typeof id!=='string'||!id||typeof at!=='number'||!Number.isFinite(at)||at<0
     ||typeof value.minute!=='number'||!Number.isFinite(value.minute)||at>value.minute
     ||!Array.isArray(value.processed)||!value.processed.includes('plan:'+id))fail('save_shelter_plan_time');
    if(shelter&&(activity.planId!==id||typeof activity.startedAt!=='number'||!Number.isFinite(activity.startedAt)||activity.startedAt<at||activity.startedAt>value.minute))fail('save_shelter_plan_time');
   }
   if(plan.some(a=>record(a)&&a.type==='mvpShelter'&&(plan.length!==1||Object.keys(a).length!==1)))fail('save_shelter_action_shape');
   if(shelter&&(!record(activity.action)||Object.keys(activity.action).length!==1))fail('save_shelter_action_shape');
   if(activity&&owns(activity,'mvpShelterEnteredAt')){
    const t=activity.mvpShelterEnteredAt;
    if(!shelter||typeof t!=='number'||!Number.isFinite(t)||typeof activity.startedAt!=='number'||!Number.isFinite(activity.startedAt)
     ||typeof value.minute!=='number'||t<0||t<activity.startedAt||t>value.minute)fail('save_shelter_arrival');
   }
  }
 }
 if(owns(value,'mvpClimate')||owns(value,'mvpSoil')||owns(value,'mvpAgriculture')){try{validateMvpClimate(value as unknown as World);}catch{fail('save_invalid_mvpClimate');}}
 for(const field of unsupportedUpgradeFields)if(owns(value,field))fail('save_unsupported_'+field);
 if(typeof value.id!=='string'||!value.id||!Number.isSafeInteger(value.revision)||Number(value.revision)<0
  ||(value.mode!=='formal'&&value.mode!=='validation'))fail('save_invalid_world_identity');
 if(owns(value,'ledgerVersion')&&value.ledgerVersion!==1)fail('save_unsupported_ledger_version');
 const landscape=owns(value,'terrainKey');
 if(landscape){
  if(value.mode!=='formal'||typeof value.terrainKey!=='string'||!value.terrainKey
   ||!Number.isSafeInteger(value.resourceCount)||Number(value.resourceCount)<0||!Array.isArray(value.resourceChanges))
   fail('save_invalid_landscape_envelope');
  const indexes=new Set<number>();
  for(const entry of value.resourceChanges){
   if(!Array.isArray(entry)||entry.length!==2||!Number.isSafeInteger(entry[0])||entry[0]<0
    ||entry[0]>=Number(value.resourceCount)||indexes.has(entry[0])||!record(entry[1]))fail('save_invalid_resource_changes');
   indexes.add(entry[0]);
  }
 }else{
  if(owns(value,'ledgerVersion'))fail('save_ledger_without_landscape');
  if(!record(value.map)||!Array.isArray(value.resources))fail('save_invalid_inline_landscape');
 }
 // Historical landscape snapshots before separate-ledger v1 still carry both
 // arrays inline. Preserve them rather than assuming missing means empty.
 if(!owns(value,'ledgerVersion')&&(!Array.isArray(value.events)||!Array.isArray(value.processed)))
  fail('save_missing_inline_ledger');
 const world=value as unknown as World;
 try{validateFormalRainProvenance(world);}catch{fail('save_invalid_formalRainProvenance');}
 if(hasMvpSpiritEffects(world.mvpClimate)||hasMvpSpiritEffectEvents(world.events)){
  if(!allowMvpSpiritEffectFixture)fail('save_mvpSpiritEffects_requires_isolated_fixture');
  try{validateMvpSpiritEffects(world);}catch{fail('save_invalid_mvpSpiritEffects');}
  const climate=world.mvpClimate;
  if(climate&&owns(climate,'spiritFruitSettlement')&&!validMvpFallenFruitSettlementLedger(world,climate.spiritFruitSettlement))
   fail('save_invalid_mvpSpiritFruitSettlement');
 }
}
function parseSavedWorld(body:unknown):unknown {
 let value:unknown;
 try{
  const json=typeof body==='string'?body:body instanceof Uint8Array?gunzipSync(body,{maxOutputLength:MAX_STATE_BYTES}).toString():fail('save_invalid_state_encoding');
  if(Buffer.byteLength(json)>MAX_STATE_BYTES)fail('save_state_too_large');
  value=JSON.parse(json);
 }catch(error){if(error instanceof SaveCompatibilityError)throw error;fail('save_invalid_state_encoding');}
 return value;
}
export function decodeSavedWorld(body:unknown,allowMvpSpiritEffectFixture=false):Record<string,unknown>{
 const value=parseSavedWorld(body);assertWorldCompatibility(value,allowMvpSpiritEffectFixture);return value;
}
export function decodeExactOrdinaryDevelopmentV3World(body:unknown,db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:OrdinaryDevelopmentV3Pin):Record<string,unknown>{
 const value=parseSavedWorld(body);
 if(!record(value))fail('save_invalid_world');
 try{assertWorldCompatibility(value);return value;}
 catch(error){
  if(!(error instanceof SaveCompatibilityError)||error.code!=='save_sealed_aged_pickup_requires_private_archive')throw error;
  const sealed=readOrdinaryDevelopmentV3(db,origin,pin,value as unknown as World);
  if(!sealed?.lifecycle?.work||!sealed.lifecycle.held)throw error;
  assertWorldCompatibilityInternal(value,false,undefined,sealed.lifecycle.held.holderId);return value;
 }
}
export function decodeExactDisposableSavedWorld(body:unknown,db:DatabaseSync,owner:DisposableRulesSaveAuthority,pin:DisposableNativeAgedTransferPin):Record<string,unknown>{
 const value=parseSavedWorld(body);
 if(!record(value))fail('save_invalid_world');
 try{assertWorldCompatibility(value);return value;}
 catch(error){
  if(!(error instanceof SaveCompatibilityError)||error.code!=='save_sealed_aged_pickup_requires_private_archive')throw error;
  const work=readExactDisposableActiveEating(db,owner,pin,value as unknown as World);
  if(!work)throw error;
  assertWorldCompatibilityInternal(value,false,work);return value;
 }
}
function jsonBlob(body:unknown):unknown {
 if(!(body instanceof Uint8Array))fail('save_invalid_landscape_encoding');
 try{return JSON.parse(gunzipSync(body,{maxOutputLength:MAX_STATE_BYTES}).toString());}
 catch{fail('save_invalid_landscape_encoding');}
}
export function assertDeveloperMvpEffectArchive(db:DatabaseSync,world:World):void {
 const expected=world.events.filter(event=>event.mvpFruitFall!==undefined);
 const archived=db.prepare("SELECT id,at,body FROM events WHERE world_id=? AND json_type(body,'$.mvpFruitFall') IS NOT NULL ORDER BY rowid LIMIT 4097").all(world.id);
 if(expected.length!==archived.length||expected.some((event,i)=>event.id!==archived[i].id||
  event.at!==archived[i].at||JSON.stringify(event)!==archived[i].body))fail('save_invalid_developer_effect_archive');
}

function inspectDatabase(db:DatabaseSync,rejectClimate:boolean,validateWorld?: (world:Record<string,unknown>)=>void,allowSeasonalModel=false,inspectSeasonalModel?:(s:SeasonalLedger|null)=>void,fixtureSeal?:string,formalOwner?:DeveloperMvpSpiritFixtureOwner,formalWeatherOwner?:DeveloperMvpSpiritFixtureOwner,nativeEmptyGround?:OrdinaryAgedGroundPin,privateDisposableSave?:DisposableRulesSaveAuthority,privateDisposableAgedTransfer?:DisposableNativeAgedTransferPin,ordinaryG2DevelopmentOrigin?:OrdinaryG2DevelopmentOrigin,ordinaryG2V3?:OrdinaryDevelopmentV3Pin):Record<string,unknown>|null {
 let g2World:string|null=null;
 try{g2World=inspectOrdinaryG2DevelopmentOrigin(db,ordinaryG2DevelopmentOrigin,ownsOrdinaryDevelopmentV3Pin(ordinaryG2V3));}
 catch{fail('save_ordinary_g2_development_origin');}
 const fixtureTable=db.prepare("SELECT name,type,sql FROM sqlite_master WHERE lower(name)='mvp_spirit_developer_fixture'").get();
 let disposableWorld:string|undefined;
 if(privateDisposableSave){
  try{disposableWorld=readDisposableRulesSaveMarker(db,privateDisposableSave);}catch{fail('save_disposable_rules_marker');}
 }else if(fixtureTable&&!fixtureSeal)fail('save_developer_fixture_requires_owner');
 if(fixtureSeal){
  if(fixtureTable?.name!=='mvp_spirit_developer_fixture'||fixtureTable.type!=='table')fail('save_unknown_developer_fixture');
  if((formalOwner||formalWeatherOwner)&&(fixtureTable.sql!=='CREATE TABLE mvp_spirit_developer_fixture (version INTEGER NOT NULL CHECK(version=1), seal TEXT NOT NULL)'||
   db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND lower(tbl_name)='mvp_spirit_developer_fixture'").get()))
   fail('save_unknown_developer_fixture');
  const seals=db.prepare('SELECT * FROM mvp_spirit_developer_fixture LIMIT 2').all();
  if(seals.length!==1||Object.keys(seals[0]).length!==2||seals[0].version!==1||seals[0].seal!==fixtureSeal)
   fail('save_unknown_developer_fixture');
 }
 let nativeAgedStorage:boolean;
 try{nativeAgedStorage=assertDisposableNativeAgedTransferStorage(db,!!disposableWorld&&isDisposableNativeAgedTransferPin(privateDisposableAgedTransfer));}
 catch{fail('save_disposable_native_aged_transfer_requires_owner');}
 try{rejectSealedAgedBirthOnGenericPath(db,fixtureSeal!==undefined);}catch{fail('save_sealed_aged_birth_requires_private_archive');}
 const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='worlds'").get();
 if(!table)fail('save_missing_worlds_table');
 let latest:Record<string,unknown>|null=null;
 for(const row of db.prepare('SELECT id,revision,length(CAST(state AS BLOB)) AS stateBytes, CASE WHEN length(CAST(state AS BLOB))<=? THEN state ELSE NULL END AS state FROM worlds ORDER BY rowid').iterate(MAX_STATE_BYTES)){
  if(typeof row.stateBytes!=='number'||row.stateBytes>MAX_STATE_BYTES)fail('save_state_too_large');
  const world=privateDisposableSave&&privateDisposableAgedTransfer?
   decodeExactDisposableSavedWorld(row.state,db,privateDisposableSave,privateDisposableAgedTransfer):
   g2World&&ordinaryG2DevelopmentOrigin&&ordinaryG2V3?decodeExactOrdinaryDevelopmentV3World(row.state,db,ordinaryG2DevelopmentOrigin,ordinaryG2V3):
   decodeSavedWorld(row.state,fixtureSeal!==undefined&&!formalOwner&&!formalWeatherOwner);
  if(g2World&&(latest!==null||world.id!==g2World||world.mode!=='validation'||owns(world,'simulationOnly')||owns(world,'mvpSeasonalModelVersion')||
   owns(world.mvpClimate as object??{},'spiritEffects')||owns(world.mvpClimate as object??{},'spiritFruitSettlement')))
   fail('save_ordinary_g2_development_world');
  if(g2World&&ordinaryG2DevelopmentOrigin&&ordinaryG2V3)try{readOrdinaryDevelopmentV3(db,ordinaryG2DevelopmentOrigin,ordinaryG2V3,world as unknown as World);}
  catch{fail('save_ordinary_g2_development_v3');}
  if(disposableWorld&&(latest!==null||world.mode!=='validation'||world.id!==disposableWorld))fail('save_disposable_rules_world');
  if(fixtureSeal&&(formalOwner||formalWeatherOwner)&&(latest!==null||world.mode!=='formal'||typeof world.id!=='string'||
   !/^valley-formal-[A-Za-z0-9_-]{1,180}$/.test(world.id)||world.mvpSeasonalModelVersion!==undefined||owns(world,'mvpClimate')))
   fail('save_unknown_developer_fixture');
  if(formalWeatherOwner&&(world.id!==formalWeatherOwner.formalWeatherPurpose?.worldId||owns(world,'simulationOnly')))
   fail('save_formal_weather_preparation_world_scope');
  if(formalOwner)assertFormalBerryMirrorHeader(db,formalOwner,String(world.id),world.formalBerryFixtureAnchor,Number(world.revision),Number(world.minute));
  else if(owns(world,'formalBerryFixtureAnchor'))fail('formal_berry_fixture_requires_owner');
  if(fixtureSeal&&!formalOwner&&!formalWeatherOwner){
   if(latest!==null||world.mode!=='validation'||world.mvpSeasonalModelVersion!==undefined||
    typeof world.id!=='string'||!world.id.startsWith('godot-mvp-')||
    !(world as unknown as World).mvpClimate?.rainProvenance)fail('save_unknown_developer_fixture');
   assertDeveloperMvpEffectArchive(db,world as unknown as World);
  }
  if(!allowSeasonalModel&&world.schemaVersion===2)fail('save_seasonal_model_requires_explicit_entry');
  if(rejectClimate&&owns(world,'mvpClimate'))fail('save_mvpClimate_requires_opt_in');
  validateWorld?.(world);
  if(world.id!==row.id||world.revision!==row.revision)fail('save_world_identity_mismatch');
  if(owns(world,'terrainKey')){
   const terrain=db.prepare('SELECT body FROM terrain WHERE hash=?').get(world.terrainKey as string);
   const base=db.prepare('SELECT body FROM resource_bases WHERE world_id=?').get(world.id as string);
   if(!terrain||!base)fail('save_missing_landscape');
   const map=jsonBlob(terrain.body),resources=jsonBlob(base.body);
   if(!record(map)||!Array.isArray(map.tiles)||!Array.isArray(resources))fail('save_invalid_landscape');
   if(createHash('sha256').update(JSON.stringify(map)).digest('hex')!==world.terrainKey)fail('saved_terrain_checksum_mismatch');
   const count=Number(world.resourceCount),changes=new Set((world.resourceChanges as unknown[][]).map(e=>e[0]));
   // A grown resource list may exceed the immutable base, but every added index
   // must have a persisted change. Otherwise readWorld would create holes.
   if(count>resources.length&&[...changes].filter(i=>Number(i)>=resources.length).length!==count-resources.length)
    fail('save_missing_resource_change');
   if(world.ledgerVersion===1){
    db.prepare('SELECT id,world_id,at,body FROM events LIMIT 0').all();
    db.prepare('SELECT world_id,receipt FROM receipts LIMIT 0').all();
   }
  }
  latest=world;
 }
 if(nativeAgedStorage){
  try{
   if(!latest||!privateDisposableSave||!privateDisposableAgedTransfer||
    !readDisposableNativeAgedTransfer(db,privateDisposableSave,privateDisposableAgedTransfer,latest as unknown as World))
    fail('save_disposable_native_aged_transfer_incompatible');
  }catch{fail('save_disposable_native_aged_transfer_incompatible');}
 }
 if(!allowSeasonalModel&&latest?.mvpSeasonalModelVersion!==undefined)fail('save_seasonal_model_requires_explicit_entry');
 const seasonal=readSeasonalLedger(db,latest as unknown as World|null,allowSeasonalModel);
 if(!!seasonal!==(latest?.mvpSeasonalModelVersion===1))fail('save_seasonal_model_ledger_missing');
 if(allowSeasonalModel)inspectSeasonalModel?.(seasonal);
 if(formalOwner&&!latest)assertFormalBerryMirrorHeader(db,formalOwner);
 try{assertOrdinaryAgedGroundStartup(db,latest,!fixtureSeal&&!allowSeasonalModel&&!rejectClimate,nativeEmptyGround);}
 catch{fail('save_ordinary_aged_ground_unsupported');}
 return latest;
}
interface SourceFile {suffix:string;fd:number;stat:BigIntStats}
function same(a:BigIntStats,b:BigIntStats):boolean {
 return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
function sourceFile(path:string,suffix:string):SourceFile|null {
 let fd:number;
 try{fd=openSync(path+suffix,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;fail('save_source_unreadable');}
 try{
  const stat=fstatSync(fd,{bigint:true});
  if(!stat.isFile()||stat.nlink!==1n)fail('save_unsafe_source');
  if(stat.size>BigInt(Number.MAX_SAFE_INTEGER))fail('save_source_too_large');
  return {suffix,fd,stat};
 }catch(error){closeSync(fd);throw error;}
}
function copySource(file:SourceFile,destination:string,buffer:Buffer):void {
 const out=openSync(destination,'wx',0o600);
 try{
  let position=0;const size=Number(file.stat.size);
  while(position<size){
   const count=readSync(file.fd,buffer,0,Math.min(buffer.length,size-position),position);
   if(count===0)fail('save_source_changed');
   let written=0;
   while(written<count){const n=writeSync(out,buffer,written,count-written);if(n===0)fail('save_copy_failed');written+=n;}
   position+=count;
  }
  if(!same(file.stat,fstatSync(file.fd,{bigint:true})))fail('save_source_changed');
 }finally{closeSync(out);}
}

function unchanged(path:string,files:ReadonlyArray<SourceFile|null>,suffixes:readonly string[]):void {
 for(let i=0;i<suffixes.length;i++){
  let current:BigIntStats|undefined;
  try{current=lstatSync(path+suffixes[i],{bigint:true});}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')fail('save_source_unreadable');}
  if(files[i]?(!current||!same(files[i]!.stat,current)):current!==undefined)fail('save_source_changed');
 }
}

/** No source SQLite connection, immutable shortcut, repair, schema write or
 * checkpoint. WAL is copied alongside the DB and SQLite reads its latest state.
 * This is not a substitute for caller-held ownership against concurrent writers.
 */
export function preflightWorldSave(path:string,options:{requireWorld?:boolean;rejectClimate?:boolean;allowSeasonalModel?:boolean;inspectSeasonalModel?:(s:SeasonalLedger|null)=>void;inspectOptionalAlmanac?:(snapshot:DatabaseSync,world:Record<string,unknown>)=>void;validateWorld?:(world:Record<string,unknown>)=>void;developerSpiritFixtureOwner?:DeveloperMvpSpiritFixtureOwner;nativeEmptyGround?:OrdinaryAgedGroundPin;privateDisposableSave?:DisposableRulesSaveAuthority;privateDisposableAgedTransfer?:DisposableNativeAgedTransferPin;ordinaryG2DevelopmentOrigin?:OrdinaryG2DevelopmentOrigin;ordinaryG2V3?:OrdinaryDevelopmentV3Pin}={}):Record<string,unknown>|null {
 const fixture=options.developerSpiritFixtureOwner,disposable=options.privateDisposableSave;
 const g2=options.ordinaryG2DevelopmentOrigin;
 if(options.ordinaryG2V3!==undefined&&(!g2||!ownsOrdinaryDevelopmentV3Pin(options.ordinaryG2V3)))fail('save_ordinary_g2_development_v3');
 if(!g2&&path!==':memory:'&&isOrdinaryG2DevelopmentOriginScratch(path))fail('save_ordinary_g2_development_origin');
 if(g2){
  if(path===':memory:'||options.rejectClimate||options.allowSeasonalModel||fixture||disposable||options.nativeEmptyGround)
   fail('save_ordinary_g2_development_origin');
  try{assertOrdinaryG2DevelopmentPath(g2,path);}catch{fail('save_ordinary_g2_development_origin');}
 }

 if(options.privateDisposableAgedTransfer!==undefined&&(!disposable||!isDisposableNativeAgedTransferPin(options.privateDisposableAgedTransfer)))
  fail('save_disposable_rules_owner');
 if(disposable!==undefined){
  if(path===':memory:'||fixture!==undefined||options.allowSeasonalModel||options.rejectClimate)fail('save_disposable_rules_owner');
  try{assertDisposableRulesSavePath(disposable,path);}catch{fail('save_disposable_rules_owner');}
 }
 if(fixture!==undefined&&(!isDeveloperMvpSpiritFixtureOwner(fixture)||fixture.database!==path||(!fixture.formalApprovalKeyPem&&!fixture.formalWeatherPurpose&&options.rejectClimate)||options.allowSeasonalModel))
  fail('save_developer_fixture_requires_owner');
 if(path===':memory:')return null;
 const suffixes=['','-wal','-journal'] as const;
 const files:Array<SourceFile|null>=[];
 let directory:string|undefined,db:DatabaseSync|undefined;
 try{
  fixture?.assertOwned();
  for(const suffix of suffixes)files.push(sourceFile(path,suffix));
  unchanged(path,files,suffixes);
  const main=files[0];
  if(!main||main.stat.size===0n){
   if(files.slice(1).some(file=>file&&file.stat.size>0n))fail('save_orphaned_journal');
   return null;
  }
  directory=mkdtempSync(join(tmpdir(),'ai-valley-preflight-'));
  const copy=join(directory,'world.sqlite'),buffer=Buffer.allocUnsafe(64*1024);
  for(const file of files)if(file)copySource(file,copy+file.suffix,buffer);
  unchanged(path,files,suffixes);
  // readOnly may create SHM on this PRIVATE copy, never on the user's save.
  db=new DatabaseSync(copy,{readOnly:true});
  if(fixture||disposable||g2)db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
  const result=inspectDatabase(db,options.rejectClimate===true,options.validateWorld,options.allowSeasonalModel===true,options.inspectSeasonalModel,fixture?.seal,fixture?.formalApprovalKeyPem?fixture:undefined,fixture?.formalWeatherPurpose?fixture:undefined,options.nativeEmptyGround,disposable,options.privateDisposableAgedTransfer,g2,options.ordinaryG2V3);
  if(!result&&options.requireWorld)fail('save_missing_world');
  if(result&&options.inspectOptionalAlmanac){db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');options.inspectOptionalAlmanac(db,result);}
  unchanged(path,files,suffixes);
  fixture?.assertOwned();
  if(g2)assertOrdinaryG2DevelopmentPath(g2,path);
  return result;
 }catch(error){if(error instanceof SaveCompatibilityError)throw error;throw new SaveCompatibilityError('save_preflight_failed');}
 finally{
  let cleanupFailed=false;
  try{db?.close();}catch{cleanupFailed=true;}
  for(const file of files)if(file){try{closeSync(file.fd);}catch{cleanupFailed=true;}}
  if(directory){try{rmSync(directory,{recursive:true,force:true});}catch{cleanupFailed=true;}}
  // Do not expose underlying filesystem paths or continue to writable startup
  // after uncertain cleanup of a private copy containing save data.
  if(cleanupFailed)fail('save_preflight_cleanup_failed');
 }
}
