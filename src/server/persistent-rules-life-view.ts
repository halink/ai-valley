import {inspectValleySpiritLifeAuthority,SqliteValleySpiritLifeReader} from './valley-spirit-life-authority.js';
import {inspectValleySpiritLifePublications,ValleySpiritLifeViewer} from './valley-spirit-life-publisher.js';
import type {DatabaseSync} from 'node:sqlite';
import type {RuntimeOwnership} from './runtime-lock.js';
import type {WorldStore} from './store.js';
import type {World} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';

export interface PersistentRulesLifeFixture {mode:'read-existing-isolated-life-fixture';worldId:string;sectionId:string;}
export function pinPersistentRulesLifeFixture(input:PersistentRulesLifeFixture|undefined):Readonly<PersistentRulesLifeFixture>|null{
 if(input===undefined)return null;
 if(!input||Object.keys(input).length!==3||input.mode!=='read-existing-isolated-life-fixture'||typeof input.worldId!=='string'||typeof input.sectionId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,180}$/.test(input.worldId)||!/^valley-life-section-[a-f0-9]{64}$/.test(input.sectionId))
  throw Error('invalid_private_life_fixture');
 return Object.freeze({mode:input.mode,worldId:input.worldId,sectionId:input.sectionId});
}
export function inspectPersistentRulesLifeFixture(db:DatabaseSync,world:Record<string,unknown>,pin:Readonly<PersistentRulesLifeFixture>){
 if(world.id!==pin.worldId||world.mode!=='validation'||Object.hasOwn(world,'simulationOnly'))throw Error('private_life_world_mismatch');
 inspectValleySpiritLifeAuthority(db,pin.worldId);
 inspectValleySpiritLifePublications(db,pin.worldId);
}
export function openPersistentRulesLifeFixture(owner:RuntimeOwnership,store:WorldStore,world:()=>World,pin:Readonly<PersistentRulesLifeFixture>){
 const committed=()=>{
  owner.assertOwned();
  const current=world(),head=store.load();
  // Match the request's current world to its authoritative committed head;
  // do not require a historical speech receipt to be authored at this revision.
  if(head?.id!==pin.worldId||head.mode!=='validation'||Object.hasOwn(head,'simulationOnly')||
   head.id!==current.id||head.revision!==current.revision||head.minute!==current.minute)return null;
  return {worldId:head.id,asOfUs:minuteToClimateUs(head.minute)};
 };
 const authority=new SqliteValleySpiritLifeReader(owner.database,pin.worldId,owner.assertOwned,committed,(receipt,head)=>
  receipt.worldId===head.worldId&&receipt.kind==='conversation-completed'&&store.verifyCommittedMvpAddressedSpeech(receipt));
 try{
  const viewer=new ValleySpiritLifeViewer({mode:'offline-synthetic-life-publication',database:owner.database,worldId:pin.worldId,assertOwned:owner.assertOwned,authority});
  if(viewer.latest(pin.worldId)?.sectionId!==pin.sectionId){viewer.close();throw Error("private_life_section_not_preapproved");}
  const latest=(id:string)=>{
   if(id!==pin.worldId)return null;
   const view=viewer.latest(id);
   return view?.sectionId===pin.sectionId?view:null;
  };
  return {latest,close(){try{viewer.close();}finally{authority.close();}}};
 }catch(error){authority.close();throw error;}
}
