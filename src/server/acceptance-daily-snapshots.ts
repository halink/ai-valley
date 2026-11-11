import {itemKeys} from '../shared/items.js';
import type {Item,World} from '../shared/types.js';

const DAY=1440;
const MAX_SPAN=10_000*DAY;
export interface DailySnapshotConfig {schema:1;fromMinute:number;endMinute:number;founderIds:string[];sourceFingerprint:string;}
export type SnapshotInventory=Record<Item,number|null>;
export interface DailyFounderSnapshot {
 id:string;status:'alive'|'dead'|null;residency:'resident'|'visitor'|'outside'|null;
 inventory:SnapshotInventory;hunger:number|null;health:number|null;energy:number|null;deathAt:number|null;unknownFields:string[];
}
const groupNames=['aliveResident','aliveVisitor','aliveOutside','dead','unknown'] as const;
type PopulationGroup=typeof groupNames[number];
export interface DailySnapshot {
 schema:1;worldId:string;minute:number;revision:number;boundaryKind:'initial'|'midnight'|'endpoint';
 founders:DailyFounderSnapshot[];
 population:{collectionAvailable:boolean;total:number|null;groups:Record<PopulationGroup,{count:number|null;ids:string[]}>;unknownFields:string[]};
 community:{coverage:'civic-stores-and-reserves';containers:Array<{id:string;kind:'store'|'reserve';inventory:SnapshotInventory}>;totals:SnapshotInventory;unknownFields:string[]};
 unknownFields:string[];
}
function invalid():never {throw new Error('invalid_daily_snapshot');}
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const minute=(v:unknown):v is number=>finite(v)&&v<=Number.MAX_SAFE_INTEGER-DAY;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/.test(v);
function keys(v:unknown,expected:string[]):asserts v is Record<string,unknown>{
 if(!record(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))invalid();
 const ds=Object.getOwnPropertyDescriptors(v);
 if(Reflect.ownKeys(v).length!==expected.length||expected.some(k=>!Object.hasOwn(ds,k)||!('value' in ds[k])))invalid();
}
function denseArray(value:unknown):value is unknown[]{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||Reflect.ownKeys(value).length!==value.length+1)return false;
 const ds=Object.getOwnPropertyDescriptors(value);return Array.from({length:value.length},(_,i)=>ds[String(i)]).every(d=>d&&'value' in d);
}
export function checkedDailySnapshotConfig(input:unknown):DailySnapshotConfig {
 keys(input,['schema','fromMinute','endMinute','founderIds','sourceFingerprint']);
 if(input.schema!==1||!minute(input.fromMinute)||!minute(input.endMinute)||input.endMinute<=input.fromMinute||input.endMinute-input.fromMinute>MAX_SPAN||!denseArray(input.founderIds)||input.founderIds.length!==9||!input.founderIds.every(id)||new Set(input.founderIds).size!==9||typeof input.sourceFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceFingerprint))invalid();
 return {schema:1,fromMinute:input.fromMinute,endMinute:input.endMinute,founderIds:[...input.founderIds] as string[],sourceFingerprint:input.sourceFingerprint};
}
export function dailyBoundaryMinutes(input:DailySnapshotConfig,throughMinute:number):number[]{
 const c=checkedDailySnapshotConfig(input);if(!minute(throughMinute))invalid();
 const end=Math.min(c.endMinute,throughMinute);if(end<c.fromMinute)return [];
 const out=[c.fromMinute];for(let n=(Math.floor(c.fromMinute/DAY)+1)*DAY;n<=end;n+=DAY)out.push(n);
 if(end===c.endMinute&&out.at(-1)!==end)out.push(end);return out;
}
export function nextDailyBoundary(at:number,input:DailySnapshotConfig):number {
 const c=checkedDailySnapshotConfig(input);if(!minute(at))invalid();
 if(at<c.fromMinute)return c.fromMinute;if(at>=c.endMinute)return Infinity;
 return Math.min((Math.floor(at/DAY)+1)*DAY,c.endMinute);
}
function boundaryKind(at:number,c:DailySnapshotConfig):DailySnapshot['boundaryKind'] {
 if(at===c.fromMinute)return 'initial';if(at>c.fromMinute&&at<=c.endMinute&&at%DAY===0)return 'midnight';if(at===c.endMinute)return 'endpoint';return invalid();
}
function inventory(bag:unknown,unknownFields:string[],prefix:string):SnapshotInventory {
 const valid=record(bag);if(!valid)unknownFields.push(prefix);
 return Object.fromEntries(itemKeys.map(key=>{
  if(!valid)return [key,null];
  if(!Object.hasOwn(bag,key))return [key,0];
  const descriptor=Object.getOwnPropertyDescriptor(bag,key);
  if(descriptor&&'value'in descriptor&&finite(descriptor.value))return [key,descriptor.value];
  unknownFields.push(`${prefix}.${key}`);return [key,null];
 })) as SnapshotInventory;
}
function founder(person:unknown,personId:string):DailyFounderSnapshot {
 const p=record(person)?person:{};const unknownFields:string[]=[];
 const status=p.status==='alive'||p.status==='dead'?p.status:null;
 const residency=p.residency==='resident'||p.residency==='visitor'||p.residency==='outside'?p.residency:null;
 if(status===null)unknownFields.push('status');if(residency===null)unknownFields.push('residency');
 const stat=(key:string)=>{if(finite(p[key]))return p[key] as number;unknownFields.push(key);return null;};
 const deathAt=minute(p.deathAt)?p.deathAt:null;if(p.deathAt!==null&&deathAt===null||status==='dead'&&deathAt===null)unknownFields.push('deathAt');
 return {id:personId,status,residency,inventory:inventory(p.inventory,unknownFields,'inventory'),hunger:stat('hunger'),health:stat('health'),energy:stat('energy'),deathAt,unknownFields};
}
/** Read only. In particular, never call foodContainers or estate initializers here. */
export function captureDailySnapshot(world:World,input:DailySnapshotConfig):DailySnapshot {
 const c=checkedDailySnapshotConfig(input);if(!id(world.id)||!minute(world.minute)||!Number.isSafeInteger(world.revision)||world.revision<0)invalid();
 const kind=boundaryKind(world.minute,c),available=Array.isArray(world.residents),people:unknown[]=available?world.residents:[];
 const groups=Object.fromEntries(groupNames.map(k=>[k,{count:available?0:null,ids:[]}])) as unknown as DailySnapshot['population']['groups'];
 const populationUnknown:string[]=available?[]:['residents'];const seen=new Set<string>();
 const identityCounts=new Map<string,number>();for(const p of people)if(record(p)&&id(p.id))identityCounts.set(p.id,(identityCounts.get(p.id)??0)+1);
 for(const p of people){
  let group:PopulationGroup='unknown';
  if(record(p)&&id(p.id)&&identityCounts.get(p.id)===1&&!seen.has(p.id)){
   seen.add(p.id);
   if(p.status==='dead')group='dead';
   else if(p.status==='alive')group=p.residency==='resident'?'aliveResident':p.residency==='visitor'?'aliveVisitor':p.residency==='outside'?'aliveOutside':'unknown';
   groups[group].ids.push(p.id);
  }else populationUnknown.push('residentIdentity');
  groups[group].count!++;
 }
 const founders=c.founderIds.map(personId=>{const matches=people.filter(p=>record(p)&&p.id===personId);return founder(matches.length===1?matches[0]:undefined,personId);});
 const communityUnknown:string[]=[];const containers:DailySnapshot['community']['containers']=[];
 const stores=world.civic?.stores,reserves=world.civic?.reserves;
 if(record(stores))for(const [key,bag]of Object.entries(stores).sort(([a],[b])=>a.localeCompare(b))){if(!id(key)){communityUnknown.push('civic.stores.identity');continue;}containers.push({id:`public:${key}`,kind:'store',inventory:inventory(bag,communityUnknown,`civic.stores.${key}`)});}
 else communityUnknown.push('civic.stores');
 const reserveIds=new Set<string>();
 if(Array.isArray(reserves))for(const r of reserves){if(!record(r)||!id(r.id)||reserveIds.has(r.id)){communityUnknown.push('civic.reserves.identity');continue;}reserveIds.add(r.id);containers.push({id:`public-reserve:${r.id}`,kind:'reserve',inventory:inventory(r.inventory,communityUnknown,`civic.reserves.${r.id}`)});}
 else communityUnknown.push('civic.reserves');
 const bags=[...Object.values(record(stores)?stores:{}),...(Array.isArray(reserves)?reserves.map(r=>r?.inventory):[])].filter(record);
 if(new Set(bags).size!==bags.length)communityUnknown.push('civic.inventoryAlias');
 const totals=communityTotals(containers,communityUnknown);
 return {schema:1,worldId:world.id,minute:world.minute,revision:world.revision,boundaryKind:kind,founders,
  population:{collectionAvailable:available,total:available&&!populationUnknown.length?people.length:null,groups,unknownFields:[...new Set(populationUnknown)]},
  community:{coverage:'civic-stores-and-reserves',containers,totals,unknownFields:communityUnknown},unknownFields:['community.publicEstateParcelsNotIncluded']};
}
const strings=(v:unknown):v is string[]=>denseArray(v)&&v.every(s=>typeof s==='string'&&s.length<=512);
function communityTotals(containers:DailySnapshot['community']['containers'],unknownFields:string[]):SnapshotInventory{
 const incomplete=unknownFields.some(k=>k==='civic.stores'||k==='civic.reserves'||k==='civic.inventoryAlias'||k.endsWith('.identity'));
 return Object.fromEntries(itemKeys.map(key=>{
  const sum=incomplete||containers.some(p=>p.inventory[key]===null)?null:containers.reduce((sum,p)=>sum+p.inventory[key]!,0);
  return [key,sum!==null&&!Number.isFinite(sum)?null:sum];
 })) as SnapshotInventory;
}
function checkedBag(v:unknown){keys(v,itemKeys);if(itemKeys.some(k=>v[k]!==null&&!finite(v[k])))invalid();}
/** Validate durable data before reporting it; no arbitrary extra fields are retained. */
export function checkedDailySnapshot(input:unknown,config?:DailySnapshotConfig):DailySnapshot {
 keys(input,['schema','worldId','minute','revision','boundaryKind','founders','population','community','unknownFields']);
 if(input.schema!==1||!id(input.worldId)||!minute(input.minute)||!Number.isSafeInteger(input.revision)||(input.revision as number)<0||!['initial','midnight','endpoint'].includes(input.boundaryKind as string)||!strings(input.unknownFields)||!denseArray(input.founders)||input.founders.length!==9)invalid();
 const ids:string[]=[];
 for(const f of input.founders){keys(f,['id','status','residency','inventory','hunger','health','energy','deathAt','unknownFields']);if(!id(f.id)||![null,'alive','dead'].includes(f.status as null)||![null,'resident','visitor','outside'].includes(f.residency as null)||!strings(f.unknownFields)||['hunger','health','energy','deathAt'].some(k=>f[k]!==null&&!finite(f[k])))invalid();checkedBag(f.inventory);ids.push(f.id);}
 if(new Set(ids).size!==9)invalid();
 keys(input.population,['collectionAvailable','total','groups','unknownFields']);const p=input.population;
 if(typeof p.collectionAvailable!=='boolean'||!strings(p.unknownFields))invalid();keys(p.groups,[...groupNames]);
 const censusIds:string[]=[];let total=0;
 for(const name of groupNames){const g=p.groups[name];keys(g,['count','ids']);if(!denseArray(g.ids)||!g.ids.every(id))invalid();censusIds.push(...g.ids);if(p.collectionAvailable){if(!Number.isSafeInteger(g.count)||(g.count as number)<g.ids.length||name!=='unknown'&&g.count!==g.ids.length)invalid();total+=g.count as number;}else if(g.count!==null||g.ids.length)invalid();}
 if(new Set(censusIds).size!==censusIds.length||p.collectionAvailable&&(p.unknownFields.includes('residentIdentity')?p.total!==null:p.total!==total)||!p.collectionAvailable&&p.total!==null)invalid();
 keys(input.community,['coverage','containers','totals','unknownFields']);const community=input.community;
 if(community.coverage!=='civic-stores-and-reserves'||!strings(community.unknownFields)||!denseArray(community.containers))invalid();
 const containerIds:string[]=[];for(const c of community.containers){keys(c,['id','kind','inventory']);if(!id(c.id)||!['store','reserve'].includes(c.kind as string))invalid();checkedBag(c.inventory);containerIds.push(c.id);}if(new Set(containerIds).size!==containerIds.length)invalid();checkedBag(community.totals);
 const totals=communityTotals(community.containers as DailySnapshot['community']['containers'],community.unknownFields);
 if(itemKeys.some(key=>(community.totals as Record<string,unknown>)[key]!==totals[key]))invalid();
 if(config){const c=checkedDailySnapshotConfig(config);if(input.boundaryKind!==boundaryKind(input.minute,c)||ids.some((v,i)=>v!==c.founderIds[i]))invalid();}
 return structuredClone(input) as unknown as DailySnapshot;
}

export function buildDailySnapshotReport(input:DailySnapshotConfig,worldId:string,throughMinute:number,snapshots:readonly DailySnapshot[]){
 const config=checkedDailySnapshotConfig(input);if(!id(worldId)||!minute(throughMinute))invalid();
 const expected=dailyBoundaryMinutes(config,throughMinute),byMinute=new Map<number,DailySnapshot>();
 for(const inputSnapshot of snapshots){const s=checkedDailySnapshot(inputSnapshot,config);if(s.worldId!==worldId||s.minute>throughMinute||byMinute.has(s.minute))invalid();byMinute.set(s.minute,s);}
 const boundaries=expected.map(at=>({minute:at,kind:boundaryKind(at,config),availability:byMinute.has(at)?'observed' as const:'missing' as const,snapshot:byMinute.get(at)??null}));
 const intervalEnds=expected.slice(1);const reached=Math.min(config.endMinute,throughMinute);
 if(reached>config.fromMinute&&expected.at(-1)!==reached)intervalEnds.push(reached);
 const intervals=intervalEnds.map((end,i)=>{const start=i===0?config.fromMinute:intervalEnds[i-1];return {fromMinute:start,endMinute:end,partialCalendarDay:start%DAY!==0||end%DAY!==0,startSnapshot:byMinute.get(start)??null,endSnapshot:byMinute.get(end)??null,endpointCoverage:byMinute.has(start)&&byMinute.has(end)?'observed' as const:'missing' as const};});
 const transitions:Array<{founderId:string;fromMinute:number;throughMinute:number;kind:'death'|'outside';from:string|null;to:string|null;exactMinute:number|null}>=[];
 const observed=boundaries.flatMap(b=>b.snapshot?[b.snapshot]:[]);
 for(let i=1;i<observed.length;i++)for(let f=0;f<config.founderIds.length;f++){
  const a=observed[i-1],b=observed[i],before=a.founders[f],after=b.founders[f];
  if(before.status!==null&&after.status!==null&&before.status!==after.status)transitions.push({founderId:after.id,fromMinute:a.minute,throughMinute:b.minute,kind:'death',from:before.status,to:after.status,exactMinute:after.status==='dead'&&after.deathAt!==null&&after.deathAt>a.minute&&after.deathAt<=b.minute?after.deathAt:null});
  if(before.residency!==null&&after.residency!==null&&before.residency!==after.residency&&(before.residency==='outside'||after.residency==='outside'))transitions.push({founderId:after.id,fromMinute:a.minute,throughMinute:b.minute,kind:'outside',from:before.residency,to:after.residency,exactMinute:null});
 }
 return {schema:1 as const,executionKind:'offline-synthetic' as const,realModelExecuted:false as const,acceptancePassed:null,worldId,config,throughMinute,boundaries,intervals,transitions,missingBoundaries:boundaries.filter(b=>b.availability==='missing').map(b=>b.minute),limitations:['Snapshots are endpoint observations, not complete food flows or consumption evidence.','Missing historical boundaries are unknown and are never reconstructed from event timestamps.','Endpoint transitions alone do not enumerate departures and returns between boundaries.','Community inventory covers civic stores and reserves only; treasuryStock is excluded to avoid double counting.']};
}
