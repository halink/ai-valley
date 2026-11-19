import {WorldStore} from './store.js';
import {acquireDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureKey} from './valley-spirit-fixture-files.js';

/** Deliberately not used by ordinary store, HTTP, rule or real model entrypoints. */
export function openDeveloperMvpSpiritFixtureStore(key:DeveloperMvpSpiritFixtureKey):WorldStore {
 const owner=acquireDeveloperMvpSpiritFixtureOwner(key);
 try{if(owner.formalApprovalKeyPem)throw Error('mvp_spirit_fixture_scope');
  return new WorldStore(owner.database,{allowMvpClimate:true,developerSpiritFixtureOwner:owner});}
 catch(error){owner.release();throw error;}
}

/** Only new private generated formal saves, never caller-supplied paths. */
export function openDeveloperFormalBerryFixtureStore(key:DeveloperMvpSpiritFixtureKey):WorldStore {
 const owner=acquireDeveloperMvpSpiritFixtureOwner(key);
 try{
  if(!owner.formalApprovalKeyPem)throw Error('formal_berry_fixture_scope');
  return new WorldStore(owner.database,{formalRainProvenance:true,developerSpiritFixtureOwner:owner});
 }catch(error){owner.release();throw error;}
}
