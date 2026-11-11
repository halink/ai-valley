import {closeSync,mkdtempSync,openSync,rmSync} from 'node:fs';
import {previewTmpdir} from '../../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {WorldStore} from './store.js';
import {ValleyRuntime} from './runtime.js';
import {FORMAL_DAY_MINUTES} from '../world/time.js';

export const PREVIEW_PORT=3413;
export async function rejectPreviewModel():Promise<never>{throw new Error('External models are disabled in the development preview');}

/** No existing path or credentials are accepted. This is a static synthetic
 * opening world, not a formal service or a real-model acceptance runner. */
export function createPreviewSession(){
 const directory=mkdtempSync(join(previewTmpdir(),'ai-valley-preview-'));
 const database=join(directory,'preview.sqlite');
 let store:WorldStore|undefined;
 try{
  // Exclusive creation is deliberate: never open an existing database.
  closeSync(openSync(database,'wx',0o600));
  store=new WorldStore(database);
  const runtime=new ValleyRuntime(store,[],rejectPreviewModel,{mode:'formal',dayMinutes:FORMAL_DAY_MINUTES});
  runtime.world.clock.reason='隔离开发预览：外部模型已禁用，世界时间不推进';
  let closed=false;
  return {directory,database,store,runtime,close(){
   if(closed)return;closed=true;
   try{runtime.stop();}finally{try{store!.close();}finally{rmSync(directory,{recursive:true,force:true});}}
  }};
 }catch(error){try{store?.close();}finally{rmSync(directory,{recursive:true,force:true});}throw error;}
}
