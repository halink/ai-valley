import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {validateFormalRainProvenance} from '../world/formal-rain-provenance.js';
import {decodeSavedWorld} from './save-preflight.js';
import {isDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';

const MODE='sealed-formal-closed-rain-objective' as const;
const exact=(u:unknown,keys:readonly string[]):u is Record<string,unknown>=>!!u&&typeof u==='object'&&!Array.isArray(u)&&
 Object.keys(u).length===keys.length&&keys.every(k=>Object.hasOwn(u,k));
const worldId=(u:unknown):u is string=>typeof u==='string'&&/^valley-formal-[A-Za-z0-9_-]{1,180}$/.test(u);
const episodeId=(u:unknown):u is string=>typeof u==='string'&&/^formal-rain:[a-f0-9]{64}$/.test(u);
const revision=(u:unknown):u is number=>typeof u==='number'&&Number.isSafeInteger(u)&&u>=0;
const minute=(u:unknown):u is number=>typeof u==='number'&&Number.isFinite(u)&&u>=0&&u<=1e9;
const disabled=Object.freeze({status:'disabled' as const});
const unavailable=Object.freeze({status:'unavailable' as const});
const missing=Object.freeze({status:'missing' as const,reason:'no-retained-native-closed-rain' as const});
export interface FormalClosedRainObjectivePin {mode:typeof MODE;worldId:string;episodeId:string;}

/** Explicit private evidence read only. No disclosure grant, route, writer,
 * transport or forecast. The original existing developer lease is required. */
export function readFormalClosedRainObjective(owner:DeveloperMvpSpiritFixtureOwner|undefined,input?:Readonly<FormalClosedRainObjectivePin>){
 if(input===undefined)return disabled;
 let db:DatabaseSync|undefined,began=false;
 try{
  if(!isDeveloperMvpSpiritFixtureOwner(owner)||!owner?.formalApprovalKeyPem)return unavailable;
  const pin=structuredClone(input);
  if(!exact(pin,['mode','worldId','episodeId'])||pin.mode!==MODE||!worldId(pin.worldId)||!episodeId(pin.episodeId))return unavailable;
  owner.assertOwned();
  db=new DatabaseSync(owner.database,{readOnly:true});
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; BEGIN');began=true;
  const tables=db.prepare("SELECT name,type FROM sqlite_schema WHERE name IN ('worlds','mvp_spirit_developer_fixture')").all();
  if(tables.length!==2||tables.some(x=>x.type!=='table'))throw Error('formal_closed_rain_schema');
  const seal=db.prepare('SELECT * FROM mvp_spirit_developer_fixture LIMIT 2').all();
  if(seal.length!==1||Object.keys(seal[0]).length!==2||seal[0].version!==1||seal[0].seal!==owner.seal)
   throw Error('formal_closed_rain_seal');
  const rows=db.prepare('SELECT id,revision,state FROM worlds LIMIT 2').all();
  if(rows.length!==1||rows[0].id!==pin.worldId||!revision(rows[0].revision))throw Error('formal_closed_rain_world');
  // Formal compact saves retain these fields in the same encoded row. No
  // terrain, resident timeline, G1 scope or latest weather inference is needed.
  const head=decodeSavedWorld(rows[0].state) as unknown as World;
  if(head.mode!=='formal'||head.id!==pin.worldId||head.revision!==rows[0].revision||!minute(head.minute)||
     Object.hasOwn(head,'simulationOnly')||Object.hasOwn(head,'mvpClimate'))throw Error('formal_closed_rain_head');
  validateFormalRainProvenance(head);
  const found=head.formalRainProvenance?.closed.find(r=>r.episodeId===pin.episodeId);
  owner.assertOwned();
  db.exec('COMMIT');began=false;
  if(!found)return missing;
  const sourceRef=head.id+'/'+found.episodeId;
  const source=Object.freeze({kind:'observed-closed-rain' as const,sourceRef,startedMinute:found.startedMinute,closedMinute:found.closedMinute});
  const sourceDigest=createHash('sha256').update(JSON.stringify(['formal-closed-rain-objective/v1',sourceRef,found.startedMinute,found.closedMinute])).digest('hex');
  return Object.freeze({status:'ready' as const,mode:MODE,projectionVersion:1 as const,worldId:head.id,
   observedHead:Object.freeze({revision:head.revision,asOfMinute:head.minute}),source,sourceDigest});
 }catch{
  if(began)try{db?.exec('ROLLBACK');}catch{/* read-only connection closes */}
  return unavailable;
 }finally{db?.close();}
}
