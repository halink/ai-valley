import {inspectValleySpiritLifeAuthority,SqliteValleySpiritLifeReader,valleySpiritLifeAuthorityOnConnection} from './valley-spirit-life-authority.js';
import {inspectValleySpiritLifePublications,ValleySpiritLifeViewer,valleySpiritLifeViewOnConnection} from './valley-spirit-life-publisher.js';
import {nativeMvpMealCustodyVerifierOnConnection,inspectValleySpiritMealCustody} from './valley-spirit-meal-custody.js';
import {readNativeValidationWeatherHead} from './valley-spirit-native-basis.js';
import {verifyValleySpiritSpeechCustody} from './valley-spirit-speech-custody.js';
import {DatabaseSync} from 'node:sqlite';
import type {RuntimeOwnership} from './runtime-lock.js';
import type {WorldStore} from './store.js';
import type {World} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';

export interface PersistentRulesLifeFixture {mode:'read-existing-isolated-life-fixture';worldId:string;sectionId:string;includeConsumedMeals?:true;}
export function pinPersistentRulesLifeFixture(input:PersistentRulesLifeFixture|undefined):Readonly<PersistentRulesLifeFixture>|null{
 if(input===undefined)return null;
 if(!input||Object.keys(input).some(k=>!['mode','worldId','sectionId','includeConsumedMeals'].includes(k))||
    (Object.hasOwn(input,'includeConsumedMeals')&&input.includeConsumedMeals!==true)||input.mode!=='read-existing-isolated-life-fixture'||typeof input.worldId!=='string'||typeof input.sectionId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,180}$/.test(input.worldId)||!/^valley-life-section-[a-f0-9]{64}$/.test(input.sectionId))
  throw Error('invalid_private_life_fixture');
 return Object.freeze({mode:input.mode,worldId:input.worldId,sectionId:input.sectionId,...input.includeConsumedMeals?{includeConsumedMeals:true as const}:{}});
}
export function inspectPersistentRulesLifeFixture(db:DatabaseSync,world:Record<string,unknown>,pin:Readonly<PersistentRulesLifeFixture>){
 if(world.id!==pin.worldId||world.mode!=='validation'||Object.hasOwn(world,'simulationOnly'))throw Error('private_life_world_mismatch');
 inspectValleySpiritLifeAuthority(db,pin.worldId);
 inspectValleySpiritLifePublications(db,pin.worldId);
 if(pin.includeConsumedMeals)inspectValleySpiritMealCustody(db,pin.worldId);
}
export function openPersistentRulesLifeFixture(owner:RuntimeOwnership,store:WorldStore,world:()=>World,pin:Readonly<PersistentRulesLifeFixture>){
 if(pin.includeConsumedMeals)return openPinnedMealLife(owner,world,pin);
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

/** One existing-owner physically read-only snapshot for latest section,
 * current grants, native speech/meal receipts, and runtime head. */
function openPinnedMealLife(owner:RuntimeOwnership,world:()=>World,pin:Readonly<PersistentRulesLifeFixture>){
 owner.assertOwned();
 const db=new DatabaseSync(owner.database,{readOnly:true});
 try{
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
  let closed=false,isolated=false;
  let verifyMeal:ReturnType<typeof nativeMvpMealCustodyVerifierOnConnection>|undefined;
  const authority=valleySpiritLifeAuthorityOnConnection(db,pin.worldId,owner.assertOwned,()=>{
   const current=world(),head=readNativeValidationWeatherHead(db,pin.worldId);
   if(!head||current.mode!=='validation'||Object.hasOwn(current,'simulationOnly')||current.id!==pin.worldId||
      head.worldRevision!==current.revision||head.atUs!==minuteToClimateUs(current.minute))return null;
   return {worldId:head.worldId,asOfUs:head.atUs};
  },receipt=>receipt.kind==='conversation-completed'?verifyValleySpiritSpeechCustody(db,receipt):
   receipt.kind==='meal-consumed'&&verifyMeal?.(receipt)===true);
  const view=valleySpiritLifeViewOnConnection(db,pin.worldId,owner.assertOwned,authority);
  const latest=(id:string)=>{
   if(closed||isolated||id!==pin.worldId)return null;
   let transaction=false;
   try{
    owner.assertOwned();db.exec('BEGIN');transaction=true;
    verifyMeal??=nativeMvpMealCustodyVerifierOnConnection(db,pin.worldId);
    const section=view(id);
    owner.assertOwned();db.exec('COMMIT');transaction=false;
    return section?.sectionId===pin.sectionId?section:null;
   }catch{
    isolated=true;
    if(transaction)try{db.exec('ROLLBACK');}catch{/* isolated */}
    return null;
   }
  };
  if(!latest(pin.worldId))throw Error('private_life_section_not_preapproved');
  return {latest,close(){if(!closed){closed=true;db.close();}}};
 }catch(e){db.close();throw e;}
}
