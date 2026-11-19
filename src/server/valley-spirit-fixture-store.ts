import {WorldStore} from './store.js';
import {acquireDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureKey} from './valley-spirit-fixture-files.js';

/** Deliberately not used by ordinary store, HTTP, rule or real model entrypoints. */
export function openDeveloperMvpSpiritFixtureStore(key:DeveloperMvpSpiritFixtureKey):WorldStore {
 const owner=acquireDeveloperMvpSpiritFixtureOwner(key);
 try{return new WorldStore(owner.database,{allowMvpClimate:true,developerSpiritFixtureOwner:owner});}
 catch(error){owner.release();throw error;}
}
