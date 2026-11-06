import {estateGoods,ownedEstateParcels} from '../src/world/estate-custody.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {advanceProduction,claimableInheritance,completeProduction,initializeProduction,nearbyClaimablePlot,productionParcels,productionTarget,productiveCrops} from '../src/world/production.js';
import {productionOpportunities} from '../src/server/production-opportunities.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {advanceLife,recordDeath} from '../src/world/life.js';
import {calendar,DAY,YEAR} from '../src/world/time.js';

function fixture(){
  const w=createWorld();w.mode='formal';w.clock.paused=false;initializeEconomy(w);initializeProduction(w);initializeForeignTrade(w);
  return {w,r:w.residents[0]};
}
function doAction(w:World,r:Resident,action:Action){
  assert.ok(submitPlan(w,{id:`production-test:${w.revision}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
    definition:w.activeDefinitions['action/routine'],intention:'仅供验证的明确测试选择',actions:[action]}).ok);
  let left=2000;
  while(r.plan||r.activity){assert.ok(left--,'action must complete');stepWorld(w,1);}
  assert.equal(r.lastFailure,null);
}

test('seed saving consumes food and labour; new varieties preserve old crop definitions',()=>{
  const {w,r}=fixture();const old=JSON.stringify(w.definitions['crop/turnip@1']);
  r.inventory={turnip:1};const before=w.minute;
  doAction(w,r,{type:'production',operation:'saveSeed'});
  assert.equal(w.minute-before,15);assert.equal(r.inventory.turnip,0);assert.equal(r.inventory.seed,2);
  assert.equal(w.production!.seedSaved,2);assert.equal(JSON.stringify(w.definitions['crop/turnip@1']),old);
  assert.match(productionTarget(w,r,{type:'production',operation:'saveSeed'}).error!,/根菜/);
  r.bornAt=w.minute-17*YEAR;
  assert.ok(productionTarget(w,r,{type:'production',operation:'saveSeed'}).error);
});

test('renewal accumulates despite repeated harvesting, survives restart, respects finite capacity and occupied sites',()=>{
  const {w,r}=fixture();
  const bush=w.resources.find(s=>s.kind==='bush')!;bush.max=8;bush.amount=0;bush.regrowthDays=4;
  for(let i=0;i<4;i++){
    w.minute+=DAY/4;bush.lastHarvest=w.minute;advanceProduction(w);
  }
  assert.equal(bush.amount,2);
  bush.amount=0;w.minute+=DAY/4;advanceProduction(w);
  const restored=JSON.parse(JSON.stringify(w)) as World,restoredBush=restored.resources.find(s=>s.id===bush.id)!;
  restored.minute+=DAY/4;advanceProduction(restored);assert.equal(restoredBush.amount,1);
  restored.minute+=20*DAY;advanceProduction(restored);assert.equal(restoredBush.amount,8);
  const tree=w.resources.find(s=>s.kind==='tree')!;tree.amount=0;r.at={...tree.at};
  w.minute+=40*DAY;advanceProduction(w);assert.equal(tree.amount,0,'tree cannot reappear under a person');
  r.at={x:27,y:27};w.minute++;advanceProduction(w);assert.ok(tree.amount>0);
  tree.amount=0;w.plots.push({id:'protected-test-field',at:{...tree.at},ownerId:r.id,crop:null});
  w.minute+=40*DAY;advanceProduction(w);assert.equal(tree.amount,0,'field cannot become a blocking tree');
  const rock=w.resources.find(s=>s.kind==='rock')!;rock.amount=0;w.minute+=YEAR;advanceProduction(w);assert.equal(rock.amount,0,'ore is a finite resource');
});

test('a migrant or new adult can physically reclaim only unallocated visible land, without mutating terrain',()=>{
  const w=createFormalWorld();w.clock.paused=false;initializeProduction(w);
  const r=w.residents.find(r=>!w.plots.some(p=>p.ownerId===r.id))!;
  r.bornAt=w.minute-20*YEAR;r.inventory.wood=3;r.residency='resident';r.inside=null;
  r.at={x:180,y:235};const at=nearbyClaimablePlot(w,r);assert.ok(at);
  const tiles=w.map.tiles.slice(),count=w.plots.length;
  doAction(w,r,{type:'production',operation:'claimPlot',at});
  assert.equal(w.plots.length,count+1);assert.equal(w.plots.at(-1)!.ownerId,r.id);assert.equal(r.inventory.wood,2);
  assert.deepEqual(w.map.tiles,tiles,'soil is a plot overlay; shared terrain remains immutable');
  assert.ok(productionTarget(w,r,{type:'production',operation:'claimPlot',at}).error);
  const own=w.plots.at(-1)!;
  for(let i=0;i<5;i++)w.plots.push({...own,id:'owned-'+i,at:{x:180+i,y:240}});
  assert.equal(nearbyClaimablePlot(w,r),undefined);
  r.residency='visitor';assert.ok(productionTarget(w,r,{type:'production',operation:'claimPlot',at:{x:181,y:235}}).error);
});

test('inheritance keeps unborn and minor shares protected, then transfers exact property and coin shares on personal acceptance',()=>{
  const {w,r:parent}=fixture(),[heir,minor]=w.residents.slice(1);
  heir.parents=[parent.id];minor.parents=[parent.id];minor.bornAt=w.minute-10*YEAR;
  parent.inventory={turnip:5,seed:3};parent.coins=11;
  for(const r of [heir,minor]){r.at={...parent.at};r.inside=parent.inside;}
  const money=totalCoins(w);recordDeath(w,parent);initializeProduction(w);
  const frozenDefinition=JSON.stringify(w.definitions['land/start@1']);
  const estate=w.estates.find(e=>e.personId===parent.id)!;
  estate.heirs.push('unborn:test:0');
  assert.equal(claimableInheritance(w,heir),undefined);
  estate.heirs=estate.heirs.filter(id=>!id.startsWith('unborn:'));
  const place=w.buildings.find(b=>b.id===parent.homeId)!;heir.at={...place.door};
  const coins=heir.coins,food=heir.inventory.turnip??0;
  assert.equal(completeProduction(w,heir,{type:'production',operation:'inherit',personId:parent.id}),null);
  assert.equal(heir.coins-coins,6);assert.equal((heir.inventory.turnip??0)-food,0);assert.equal(ownedEstateParcels(w,heir).reduce((n,p)=>n+(p.inventory.turnip??0),0),3);
  assert.equal(estate.coins,5);assert.equal(estateGoods(w,parent.id).turnip,2);assert.equal(estate.status,'protected');
  assert.equal(place.ownerId,heir.id);assert.equal(totalCoins(w),money);
  assert.equal(productionParcels(w)[0].ownerId,heir.id);
  assert.equal(JSON.stringify(w.definitions['land/start@1']),frozenDefinition,'inheritance does not rewrite old content definitions');
  assert.ok(completeProduction(w,heir,{type:'production',operation:'inherit',personId:parent.id}));
  assert.ok(productionTarget(w,minor,{type:'production',operation:'inherit',personId:parent.id}).error);
  const saved=JSON.parse(JSON.stringify(w)) as World,savedMinor=saved.residents.find(p=>p.id===minor.id)!;
  savedMinor.bornAt=saved.minute-18*YEAR;savedMinor.at={...place.door};savedMinor.memories=[];
  assert.equal(completeProduction(saved,savedMinor,{type:'production',operation:'inherit',personId:parent.id}),null);
  assert.equal(saved.estates.find(e=>e.personId===parent.id)!.status,'settled');assert.equal(totalCoins(saved),money);
});

test('repair needs real ownership and materials; a long-neglected house can be restored',()=>{
  const {w,r}=fixture();const home=w.buildings.find(b=>b.ownerId===r.id)!;
  home.condition=0;r.inventory={wood:2,stone:1};
  doAction(w,r,{type:'production',operation:'repair',buildingId:home.id});
  assert.equal(home.condition,20);assert.equal(r.inventory.wood,0);assert.equal(r.inventory.stone,0);
  const other=w.residents[1];other.inventory={wood:10,stone:10};
  assert.ok(productionTarget(w,other,{type:'production',operation:'repair',buildingId:home.id}).error);
});

test('a prepared inheritance follows a deceased heir through pregnancy into the actual newborn identity',()=>{
  const {w,r:grandparent}=fixture(),[adult,heir]=w.residents.slice(1);
  adult.parents=[grandparent.id];heir.parents=[grandparent.id];
  for(const p of [adult,heir])p.at={...grandparent.at};
  grandparent.coins=15;const money=totalCoins(w);
  recordDeath(w,grandparent);initializeProduction(w);
  adult.at={...w.buildings.find(b=>b.id===grandparent.homeId)!.door};
  assert.equal(completeProduction(w,adult,{type:'production',operation:'inherit',personId:grandparent.id}),null);
  const gestator=structuredClone(adult);gestator.id='gestator';gestator.parents=[];gestator.relations=[];gestator.coins=0;
  gestator.pregnancy={otherParentId:heir.id,conceivedAt:w.minute,dueAt:w.minute+1,definition:'life/basic@1'};w.residents.push(gestator);
  recordDeath(w,heir);advanceProduction(w);
  assert.ok(w.production!.inheritances[grandparent.id].shares.some(s=>s.heirId.startsWith('unborn:')));
  w.minute++;advanceLife(w,1);
  const child=w.residents.find(p=>p.parents.includes(gestator.id))!;assert.ok(child);
  const share=w.production!.inheritances[grandparent.id].shares.find(s=>s.heirId===child.id)!;assert.ok(share);assert.equal(share.coins,7);
  assert.equal(totalCoins(w),money);assert.ok(!w.production!.inheritances[grandparent.id].shares.some(s=>s.heirId.startsWith('unborn:')));
});

test('four-season planned cultivation has enough renewable daily food capacity for 54 people',()=>{
  const w=createFormalWorld();initializeProduction(w);
  const dailyNeed=54*.038*DAY/20;
  for(const crop of productiveCrops.filter(c=>!c.data.output||c.data.output==='turnip')){
    const netPerPlot=(Number(crop.data.yield)-.5)/Number(crop.data.growthDays);
    assert.ok(w.plots.length*netPerPlot>dailyNeed*2,'food capacity includes seed saving and headroom');
  }
  assert.equal(w.residents.length,54);
});

test('three simulated years of actual plans renew seeds, water and food across seasons without grants or scripted production',()=>{
  // This deterministic controller validates physical feasibility; it is not evidence of live-model choices.
  const {w,r}=fixture();w.residents=[r];w.buildings=w.buildings.filter(b=>b.ownerId===r.id);
  const home=w.buildings[0];home.at={x:2,y:1};home.width=3;home.height=2;home.door={x:3,y:3};r.at={...home.door};
  w.map={width:16,height:16,tiles:Array(256).fill('grass'),name:'隔离生产验收世界',entrance:{x:1,y:3}};
  w.graves=[];w.events=[];w.plots=Array.from({length:3},(_,i)=>({id:'cycle-field-'+i,at:{x:5,y:3+i},ownerId:r.id,crop:null}));
  w.resources=[{id:'water-cycle',kind:'spring',at:{x:4,y:3},max:600,amount:600,regrowthDays:1,lastHarvest:0},
    {id:'wood-cycle',kind:'tree',at:{x:7,y:3},max:9,amount:9,regrowthDays:28,lastHarvest:0},
    {id:'stone-cycle',kind:'rock',at:{x:7,y:4},max:24,amount:24,regrowthDays:0,lastHarvest:0}];
  r.knownResources=w.resources.map(s=>s.id);r.knownBuildings=[home.id];r.knownPeople=[];
  r.inventory={seed:6,turnip:30,water:12,wood:2,stone:1};r.hunger=10;r.energy=100;r.health=100;
  initializeProduction(w);const seedOpening=r.inventory.seed!,foodOpening=r.inventory.turnip!,coinOpening=totalCoins(w),end=w.minute+3*YEAR;
  const harvested=new Set<string>();let loops=0;
  while(w.minute<end){
    assert.ok(++loops<20000);
    if(r.hunger>=45){assert.ok((r.inventory.turnip??0)>0,'food must be produced before eating');doAction(w,r,{type:'eat',item:'turnip'});continue;}
    if(r.energy<45){doAction(w,r,{type:'sleep',minutes:360});continue;}
    if((r.inventory.seed??0)<2){doAction(w,r,{type:'production',operation:'saveSeed'});continue;}
    const cropId=productiveCrops.find(d=>(d.data.seasons as string[]).includes(calendar(w.minute).season))!;
    const ripe=w.plots.find(p=>p.crop&&p.crop.growth>=Number(w.definitions[p.crop.definition].data.growthDays));
    if(ripe){harvested.add(ripe.crop!.definition);doAction(w,r,{type:'harvest',plotId:ripe.id});continue;}
    const stale=w.plots.find(p=>p.crop&&!(w.definitions[p.crop.definition].data.seasons as string[]).includes(calendar(w.minute).season));
    if(stale){doAction(w,r,{type:'production',operation:'clearPlot',plotId:stale.id});continue;}
    const empty=w.plots.find(p=>!p.crop);
    if(empty){doAction(w,r,{type:'production',operation:'plantCrop',plotId:empty.id,cropId:cropId.id+'@'+cropId.version});continue;}
    const dry=w.plots.find(p=>p.crop&&p.crop.wateredDay!==Math.floor(w.minute/DAY)&&p.crop.growth<Number(w.definitions[p.crop.definition].data.growthDays));
    if(dry){
      if((r.inventory.water??0)<1)doAction(w,r,{type:'gather',resourceId:'water-cycle',quantity:12});
      else doAction(w,r,{type:'water',plotId:dry.id});continue;
    }
    if(home.condition<=80){
      if((r.inventory.wood??0)<2)doAction(w,r,{type:'gather',resourceId:'wood-cycle',quantity:3});
      else if((r.inventory.stone??0)<1)doAction(w,r,{type:'gather',resourceId:'stone-cycle',quantity:3});
      else doAction(w,r,{type:'production',operation:'repair',buildingId:home.id});continue;
    }
    doAction(w,r,{type:'wait',minutes:240});
    assert.equal(r.status,'alive');
  }
  assert.equal(r.status,'alive');assert.ok(r.health>90);assert.ok((r.inventory.turnip??0)>foodOpening);
  assert.ok(w.production!.seedSaved>seedOpening);assert.equal(harvested.size,3);assert.equal(totalCoins(w),coinOpening);
  assert.ok(w.production!.repairs>=1);assert.ok(w.resources[0].amount>0);assert.ok(home.condition>0);
  assert.ok(productionOpportunities(w,r).every(c=>c.action.type==='production'||['water','harvest'].includes(c.action.type)));
});
