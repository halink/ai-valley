import type {MvpGroundFruitState} from '../shared/mvp-ground-fruit.js';
import {hasMvpHamlet,isSupportedMvpMap} from '../shared/mvp-hamlet.js';
import {inLand,reservedLandRights} from '../shared/land-rights.js';
import {pastureEdgeOpen} from '../shared/pasture-access.js';
import type {Resource,Vec,World} from '../shared/types.js';
import {minuteToClimateUs,parseClimateUs} from './mvp-climate.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {validPoint} from './outdoor-observation.js';
import {pastureContains} from './pasture.js';
import {productionParcels} from './production.js';

const MAX_SCHEMA_ITEMS=4096; // Wire-format safety bound, not a gameplay quota.
const token=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9:_-]{1,200}$/.test(v);
const exact=(v:unknown,keys:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const targetId=(p:Vec)=>'ground:'+p.x+':'+p.y;
// Binding to the registered source's fixed position prevents a moved or
// replaced-at-another-site source from inheriting the offer. The MVP registry
// has no operation that replaces a source in place or reuses a registered ID.
const instanceId=(id:string,at:Vec)=>'mvp-fruit:'+id+':'+at.x+':'+at.y;
const noRights=(w:World,p:Vec)=>!w.plots.some(x=>same(x.at,p))&&
 !reservedLandRights(w).some(x=>inLand({...x.at,width:x.width,height:x.height},p))&&
 // Definitions for the large formal map can be present in the compact save
 // without its land system; only its actually adopted rights have authority.
 (!w.production||!productionParcels(w).some(x=>x.ownerId!=='commons'&&inLand(x,p)))&&
 !Object.values(w.construction?.yards??{}).some(x=>inLand(x,p))&&!pastureContains(w,p);
const checkedPoint=(w:World,p:unknown):p is Vec=>exact(p,['x','y'])&&validPoint(w,p as Vec);
const inScope=(w:World)=>hasMvpHamlet(w)&&isSupportedMvpMap(w.map)&&
 w.mvpClimate?.rainProvenance?.version===1&&w.mvpClimate.lastUs===minuteToClimateUs(w.minute);

/** Validate intrinsic evidence only. Later obstructions, source depletion and
 * the rolling rain window cannot erase an actual existing ground lot. Actual
 * persistence will additionally require effect receipts and atomic accounting. */
export function validateMvpGroundFruitState(world:World,value:unknown):asserts value is MvpGroundFruitState {
 if(!inScope(world)||!exact(value,['version','items']))throw Error('mvp_ground_fruit_invalid_state');
 const state=value as MvpGroundFruitState;
 if(state.version!==1||!Array.isArray(state.items)||state.items.length>MAX_SCHEMA_ITEMS)
  throw Error('mvp_ground_fruit_unsupported_state');
 const now=parseClimateUs(minuteToClimateUs(world.minute)),adopted=parseClimateUs(world.mvpClimate!.rainProvenance!.adoptedUs);
 const rainPrefix=world.id+':rain:',effects=new Set<string>();
 for(const fruit of state.items){
  if(!exact(fruit,['effectId','kind','amount','ownerId','sourceResourceId','sourceResourceInstanceId','sourceAt','rainEventId','at','placedUs'])||
   fruit.kind!=='fallen-fruit'||fruit.amount!==1||fruit.ownerId!=='commons'||
   !token(fruit.effectId)||effects.has(fruit.effectId)||!token(fruit.sourceResourceId)||
   !checkedPoint(world,fruit.sourceAt)||!checkedPoint(world,fruit.at)||distance(fruit.sourceAt,fruit.at)!==1||
   !token(fruit.sourceResourceInstanceId)||fruit.sourceResourceInstanceId!==instanceId(fruit.sourceResourceId,fruit.sourceAt)||
   !token(fruit.rainEventId)||!fruit.rainEventId.startsWith(rainPrefix))throw Error('mvp_ground_fruit_invalid_lot');
  const placed=parseClimateUs(fruit.placedUs),rainStart=parseClimateUs(fruit.rainEventId.slice(rainPrefix.length));
  if(rainStart<adopted||rainStart>=placed||placed>now)throw Error('mvp_ground_fruit_invalid_time');
  effects.add(fruit.effectId);
 }
}

export interface MvpGroundFruitCapacity {
 readonly worldLots:number;
 readonly lotsPerTarget:number;
}
/** Current common-ground access does not rely on the old source still
 * existing. A new land right/obstruction may block access, but never erases
 * a durable ground lot. */
export function canAccessMvpGroundFruitTile(world:World,at:Vec):boolean {
 return validPoint(world,at)&&world.map.tiles[at.y*world.map.width+at.x]==='grass'&&walkable(world,at)&&
  !world.resources.some(r=>same(r.at,at))&&!world.graves.some(g=>same(g.at,at))&&
  !world.buildings.some(b=>same(b.door,at))&&!world.map.mvpGarden?.trees.some(t=>same(t.at,at))&&
  (!world.map.mvpGarden?.well||!same(world.map.mvpGarden.well,at))&&noRights(world,at);
}

function physicallyEligible(world:World,source:Resource,at:Vec):boolean {
 if(!canAccessMvpGroundFruitTile(world,at)||distance(source.at,at)!==1||!pastureEdgeOpen(world,source.at,at))return false;
 const entrance=world.map.entrance;
 return walkable(world,entrance)&&noRights(world,entrance)&&
  findPath(world,entrance,at,false,world.map.width*world.map.height,(_from,to)=>noRights(world,to))!==null;
}

/** Snapshot-only feasibility of exactly one declared source/target. The only
 * supported source scope has ordinary communal MVP gather rights. No fallback
 * site, maturity guess, reserve/debit, notice, or pickup is performed. */
export function inspectMvpGroundFruitPlacement(
 world:World,state:MvpGroundFruitState,sourceId:string,at:Vec,capacity?:MvpGroundFruitCapacity,
) {
 if(!inScope(world))return null;
 validateMvpGroundFruitState(world,state);
 if(!token(sourceId)||!checkedPoint(world,at)||!capacity||!exact(capacity,['worldLots','lotsPerTarget'])||
  !natural(capacity.worldLots)||capacity.worldLots>MAX_SCHEMA_ITEMS||
  !natural(capacity.lotsPerTarget)||capacity.lotsPerTarget>capacity.worldLots)return null;
 const registered=world.mvpResources?.addedResourceIds.filter(id=>id===sourceId),sources=world.resources.filter(r=>r.id===sourceId);
 if(registered?.length!==1||sources.length!==1||!Object.hasOwn(world.mvpResources!.renewal,sourceId))return null;
 const source=sources[0];
 if(source.kind!=='bush'||source.foodItem!=='fruit'||!checkedPoint(world,source.at)||!noRights(world,source.at)||
  !walkable(world,source.at)||!natural(source.amount)||!natural(source.max)||source.amount>source.max||
  source.amount<1||!physicallyEligible(world,source,at))return null;
 const localLots=state.items.filter(fruit=>same(fruit.at,at)).length;
 const freeCapacity=Math.min(capacity.worldLots-state.items.length,capacity.lotsPerTarget-localLots);
 if(freeCapacity<1)return null;
 const resourceInstanceId=instanceId(source.id,source.at);
 if(!token(resourceInstanceId))return null;
 return {
  source:{resourceInstanceId,ownerId:'commons' as const,ripeAvailable:source.amount},
  target:{id:targetId(at),freeCapacity,reachable:true as const,preservesOwnerId:'commons' as const,
   canHoldGroundFruit:true as const,supportsGroundFood:false as const,supportsDiscovery:false as const,supportsPickup:false as const},
 };
}
