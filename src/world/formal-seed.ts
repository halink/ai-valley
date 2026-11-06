import type {Building, BuildingKind, ContentDefinition, Relation, Resident, Vec, World} from '../shared/types.js';
import {emitEvent} from './events.js';
import {createFormalGeography,createFrontierGeography} from './formal-geography.js';
import {foundingHouseholds, type Founder, type HouseholdKind} from './founders.js';
import {initializeFrontierHazards} from './frontier-hazards.js';
import {seedFrontierLivelihood} from './frontier-livelihood.js';
import {distance, walkable} from './navigation.js';
import {startingDefinitions} from './starting-content.js';
import {DAY, YEAR, FORMAL_DAY_MINUTES} from './time.js';

const dawn = 8 * 60;
const hair = [0x462b1e, 0x3f2925, 0x594531, 0x944e21, 0x443442, 0x3f3434];
const shirts = [0x4587ad, 0xb63f4b, 0x458256, 0xd8873f, 0x916399, 0x343f87, 0x936944, 0x4b9b9a, 0xbb7990];
const skin = [0xf1c095, 0xe1a67e, 0xd79969, 0xc48a64, 0xa5684f];

const founderId = (house:number, member:number) => `founder-${house + 1}-${member + 1}`;

function createBuilding(
  definition:ContentDefinition, name:string, id:string, kind:BuildingKind, at:Vec,
  ownerId:string, residents:string[] = [],
):Building {
  const {width,height,capacity} = definition.data;
  return {
    id,kind,name,at:{...at},width:Number(width),height:Number(height),
    door:{x:at.x + Math.floor(Number(width) / 2), y:at.y + Number(height)},
    ownerId,definition:`${definition.id}@${definition.version}`,capacity:Number(capacity),residents,condition:100,
  };
}

/** A family may arrive together, but each person starts on a separate walkable tile. */
function doorstep(world:World, home:Building, occupied:Set<number>):Vec {
  for (const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[1,1],[-1,1],[0,2]]) {
    const at = {x:home.door.x + dx, y:home.door.y + dy};
    const key = at.y * world.map.width + at.x;
    if (occupied.has(key) || !walkable(world,at)) continue;
    occupied.add(key);
    return at;
  }
  throw new Error(`No walkable arrival tile at ${home.name}`);
}

function createFounder(world:World, person:Founder, house:number, member:number, home:Building, at:Vec):Resident {
  const [name,age,experience,disposition] = person;
  const index = house * 3 + member;
  // Birthdays remain distributed through the year and through the day.
  const birthdayOffset = ((index * 37 + 9) % 112) * DAY + (index * 13) % 1440;
  const skilled = experience !== 'beginner';
  const skills:Resident['skills'] = {farming:0,building:0,care:0};
  if (skilled) skills[experience] = 1 + (index % 3);
  const inventory = world.scenario==='frontier'?{
    berry:2+index%2,meal:1,turnip:2,water:4,
    ...(age>=18?{wood:experience==='building'?8:2,stone:experience==='building'?4:1,seed:experience==='farming'?6:3}:{}),
    ...(index===3?{medicine:1}:{}),
  }:{
    berry:6 + index % 4, meal:2, turnip:3, water:4,
    ...(age >= 18 ? {wood:experience === 'building'?12:3, stone:experience === 'building'?6:2, seed:experience === 'farming'?8:4} : {}),
  };
  return {
    id:founderId(house,member),name,appearance:{hair:age>=62?0x999394:hair[index%hair.length],
      shirt:shirts[(index*5+house)%shirts.length],skin:skin[(index+house)%skin.length]},
    at,inside:null,bornAt:dawn-age*YEAR-birthdayOffset,status:'alive',residency:'resident',
    homeId:home.id,traits:[disposition],hunger:14+index%17,energy:79+index%16,health:91+index%10,
    inventory,coins:world.scenario==='frontier'?(age>=18?12+index%7:1+index%3):(age>=18?22+index%27:2+index%5),skills,relations:[],memories:[],
    knownPeople:home.residents.filter(id=>id!==founderId(house,member)),
    knownResources:world.resources.filter(resource=>distance(resource.at,at)<=7).map(resource=>resource.id),
    knownBuildings:world.buildings.filter(building=>building===home||distance(building.door,at)<=10).map(building=>building.id),
    plan:null,activity:null,intention:'',revision:0,decisionDue:dawn,lastDecisionAt:-1,lastFailure:null,
    parents:[],guardianIds:[],pregnancy:null,canDecide:true,canExpress:true,refusesCare:false,deathAt:null,
  };
}

function recordHousehold(world:World, home:Building, members:Resident[], kind:HouseholdKind) {
  const [first,second,third] = members;
  const relationships: string[] = [];
  function connect(a:Resident,b:Resident,fact:Pick<Relation,'kin'|'partner'>) {
    a.relations.push({targetId:b.id,affection:0,trust:0,conflict:0,evidence:[],...fact});
  }
  function married(a:Resident,b:Resident) {
    connect(a,b,{partner:'married'}); connect(b,a,{partner:'married'});
    relationships.push(`${a.name}与${b.name}为伴侣`);
  }
  function parentOf(adult:Resident,child:Resident) {
    child.parents.push(adult.id);
    if (world.minute - child.bornAt < 18*YEAR) child.guardianIds.push(adult.id);
    connect(adult,child,{kin:'child'}); connect(child,adult,{kin:'parent'});
    relationships.push(`${adult.name}是${child.name}的家长`);
  }
  function siblings(a:Resident,b:Resident) {
    connect(a,b,{kin:'sibling'}); connect(b,a,{kin:'sibling'});
    relationships.push(`${a.name}与${b.name}是手足`);
  }
  switch (kind) {
    case 'parents-child': married(first,second); parentOf(first,third); parentOf(second,third); break;
    case 'generations': parentOf(first,second); parentOf(second,third); break;
    case 'parent-siblings': parentOf(first,second); parentOf(first,third); siblings(second,third); break;
    case 'partners': married(first,second); break;
    case 'parent-child': parentOf(first,second); break;
    case 'siblings': siblings(first,second); break;
    case 'housemates': case 'single': break;
  }
  const who = members.map(member=>member.name).join('、');
  const detail = relationships.length ? relationships.join('，')+'。' : '';
  const event = emitEvent(world,{
    kind:'system',actors:home.residents.slice(),place:home.door,witnesses:home.residents,
    text:`开局户籍：${who}住在${home.name}。房屋登记在${first.name}名下。${detail}`,
  });
  for (const member of members) for (const relation of member.relations) relation.evidence.push(event.id);
}

export function createFormalWorld(seed=5401):World {
  return createSettlement(seed,createFormalGeography(seed),false);
}

export function createFrontierWorld(seed=5401):World {
  const geography=createFrontierGeography(seed);
  const world=createSettlement(seed,geography,true);
  for(const resident of world.residents){
    resident.knownBuildings.push('frontier-hall');
    if(resident.id==='founder-1-1')resident.knownBuildings.push('frontier-barn');
    resident.knownResources.push(geography.wellId);
  }
  seedFrontierLivelihood(world,{barnId:'frontier-barn',pasture:geography.pasture,shore:geography.fishingShore,fisherId:'founder-3-2'});
  initializeFrontierHazards(world);
  return world;
}

function createSettlement(seed:number,geography:ReturnType<typeof createFormalGeography>,frontier:boolean):World {
  const {homeSites,buildSites,plots} = geography;
  const households=frontier?foundingHouseholds.slice(0,3):foundingHouseholds;
  if (homeSites.length!==households.length || buildSites.length!==homeSites.length || plots.length!==homeSites.length) {
    throw new Error('Founding household addresses, building parcels and farmland must match');
  }
  const definitions = startingDefinitions(buildSites.map((at,house)=>({
    ...at,ownerId:founderId(house,0),width:9,height:7,
  })));
  // Extra beds in existing family homes are a versioned feature of these particular houses.
  const homeDefinition=definitions['building/home@1'];
  definitions['building/home@2'] = {
    ...homeDefinition,version:2,cost:{wood:32,stone:16},data:{...homeDefinition.data,capacity:4},
  };
  const activeDefinitions=Object.fromEntries(Object.entries(definitions)
    .filter(([,definition])=>definition.version===1).map(([key,definition])=>[definition.id,key]));
  const homes = households.map((household,house)=>{
    const memberIds=household.people.map((_,member)=>founderId(house,member));
    const definition=household.people.length>2 ? definitions['building/home@2'] : homeDefinition;
    return createBuilding(definition,household.houseName,`hearth-${house+1}`,'home',homeSites[house],memberIds[0],memberIds);
  });
  const facilities=geography.civicSites.map((site,index)=>createBuilding(
    definitions[`building/${site.kind}@1`],site.name,site.id??`commons-${site.kind}-${index+1}`,site.kind,site.at,site.ownerId??'commons',
  ));
  const world:World = {
    schemaVersion:1,id:frontier?`valley-formal-frontier-${seed}`:`valley-formal-${seed}`,seed,mode:'formal',
    ...(frontier?{scenario:'frontier' as const}:{}),minute:dawn,revision:0,lastWallAt:0,
    clock:{paused:true,reason:'正在等待居民获得首次自主决策机会',realMinutesPerDay:FORMAL_DAY_MINUTES},weather:'sun',
    map:geography.map,resources:geography.resources,buildings:[...homes,...facilities],
    plots:plots.flatMap((site,house)=>{
      const adultIds=households[house].people.flatMap((person,member)=>person[1]>=18?[founderId(house,member)]:[]);
      return site.map((at,index)=>({id:`field-${house+1}-${index+1}`,at:{...at},ownerId:adultIds[index%adultIds.length],crop:null}));
    }),
    graves:geography.graveSites.map((at,index)=>({id:`grave-${index+1}`,at:{...at},personId:null,buriedAt:null})),
    residents:[],events:[],offers:[],proposals:[],estates:[],processed:[],definitions,activeDefinitions,
    metrics:{requests:0,successes:0,failures:0,inputTokens:0,outputTokens:0,lastLatencyMs:0,
      lastError:null,inFlight:[],model:'THUDM/GLM-Z1-9B-0414',configured:false},
  };
  const occupied=new Set<number>();
  households.forEach((household,house)=>{
    const home=homes[house];
    const members=household.people.map((person,member)=>createFounder(world,person,house,member,home,doorstep(world,home,occupied)));
    world.residents.push(...members);
    recordHousehold(world,home,members,household.kind);
  });
  return world;
}
