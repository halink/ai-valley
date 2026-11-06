import {foodTransaction,initializeFood} from '../src/world/food.js';
import {estateGoods,estateParcels,ownedEstateParcels} from '../src/world/estate-custody.js';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import type {World,Resident,Building,Inventory} from '../src/shared/types.js';
import type {IndustryAction} from '../src/shared/industry.js';
import {initializeIndustry,industryTarget,industryWorkError,completeIndustry,advanceIndustry,industryAssets} from '../src/world/industry.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeEducation} from '../src/world/education.js';
import {initializeProduction,completeProduction,productionTarget} from '../src/world/production.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {totalCoins} from '../src/world/economy.js';import {recordDeath} from '../src/world/life.js';import {DAY,YEAR} from '../src/world/time.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';import {parseChoice} from '../src/server/affordances.js';
function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.map={width:40,height:36,tiles:Array(40*36).fill('grass'),entrance:{x:1,y:1},name:'隔离产业验收'};
 const [r,heir,other]=w.residents;for(const p of w.residents){p.at={x:5,y:7};p.inside=null;p.bornAt=w.minute-25*YEAR;p.health=p.energy=100;p.hunger=0;p.inventory={wood:100,stone:100,water:100,turnip:40,seed:20,meal:20};p.coins=100;p.skills={farming:2,building:2,care:2};}
 const home:Building={id:'home-lin',kind:'home',name:'原住屋',at:{x:2,y:2},width:6,height:5,door:{x:5,y:7},capacity:4,residents:[r.id,heir.id],ownerId:r.id,definition:'building/home@1',condition:100};
 const make=(id:string,kind:Building['kind'],x:number,y:number):Building=>({...home,id,kind,name:id,at:{x,y},door:{x:x+3,y:y+5},width:7,height:5,residents:[],definition:`building/${kind}@1`});
 const workshop=make('workshop','workshop',14,2),barn=make('barn','barn',2,22),house=make('greenhouse','greenhouse',24,22),hall={...make('hall','lodge',24,2),ownerId:'commons'};
 w.buildings=[home,workshop,barn,house,hall];w.resources=[{id:'rock',kind:'rock',at:{x:18,y:20},amount:6,max:6,regrowthDays:0,lastHarvest:0}];w.graves=[];w.plots=[{id:'field',ownerId:r.id,at:{x:10,y:10},crop:null}];for(let y=5;y<20;y++)w.map.tiles[y*40+30]='water';
 for(const p of w.residents){p.homeId=home.id;p.knownBuildings=w.buildings.map(b=>b.id);p.knownResources=['rock'];}heir.parents=[r.id];other.parents=[];
 initializeForeignTrade(w);initializeEducation(w);initializeIndustry(w);initializeProduction(w);return {w,r,heir,other,home,workshop,barn,house,hall};
}
function work(w:World,r:Resident,body:Omit<IndustryAction,'type'>){r.health=r.energy=100;const a:IndustryAction={type:'industry',...body};const t=industryTarget(w,r,a);assert.equal(t.error,undefined);assert.ok(submitPlan(w,{id:`industry-test:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人明确的产业选择',actions:[a]}).ok);let guard=4000;while(r.activity||r.plan){assert.ok(guard--);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function stockCrates(w:World,r:Resident,item:'chickCrate'|'goatCrate',n:number){initializeFood(w);foodTransaction(w,()=>{const m=w.foreignTrade!.merchants[0];m.person.inventory[item]!-=n;r.inventory[item]=(r.inventory[item]??0)+n;});}
function craft(w:World,r:Resident,buildingId:string,recipeId:string,minutes=120){work(w,r,{operation:'craft',buildingId,recipeId,minutes});}
test('industries register finite sources once without coins, animals or production being given to residents',()=>{
 const {w,r}=fixture(),money=totalCoins(w);const stock={...w.foreignTrade!.merchants[0].person.inventory};initializeIndustry(w);assert.deepEqual(w.foreignTrade!.merchants[0].person.inventory,stock);assert.equal(stock.chickCrate,6);assert.equal(w.industry!.animals.length,0);assert.equal(r.inventory.chickCrate,undefined);assert.equal(totalCoins(w),money);assert.deepEqual(w.industry!.mines[0].remaining,[6,12,12]);
});
test('crafting reserves real materials, keeps partial progress and produces only when physically complete',()=>{
 const {w,r,home}=fixture();const before={...r.inventory};craft(w,r,home.id,'sapling',30);assert.equal(r.inventory.seed,before.seed!-2);assert.equal(r.inventory.sapling,undefined);assert.equal(w.industry!.batches[0].worked,30);craft(w,r,home.id,'sapling',60);assert.equal(r.inventory.sapling,1);assert.equal(w.industry!.batches[0].worked,90);assert.equal(w.industry!.batches[0].status,'completed');
 assert.ok(industryWorkError(w,r,{type:'industry',operation:'craft',buildingId:home.id,recipeId:'sapling',minutes:30},30));
});
test('the actual same-tick craft hook cannot duplicate output or debit another batch',()=>{
 const {w,r,home}=fixture();r.activity={planId:'one-craft',startedAt:w.minute,remaining:20,path:[],target:{...home.door},definition:'action/routine@1',action:{type:'industry',operation:'craft',buildingId:home.id,recipeId:'fiber',minutes:20}};w.minute+=20;const a=r.activity.action as IndustryAction;assert.equal(industryWorkError(w,r,a,20),null);const inv={...r.inventory};assert.equal(industryWorkError(w,r,a,20),null);assert.deepEqual(r.inventory,inv);assert.equal(w.industry!.batches.length,1);
});
test('real installed stations and materials connect milling, smelting and preserving to usable goods',()=>{
 const {w,r,workshop}=fixture();assert.ok(industryTarget(w,r,{type:'industry',operation:'craft',buildingId:workshop.id,recipeId:'bar',minutes:120}).error);
 work(w,r,{operation:'install',buildingId:workshop.id,station:'forge'});r.inventory.ore=4;r.inventory.coal=2;craft(w,r,workshop.id,'bar');assert.equal(r.inventory.bar,1);assert.equal(r.inventory.ore,2);assert.equal(r.inventory.coal,1);
 work(w,r,{operation:'install',buildingId:workshop.id,station:'mill'});r.inventory.grain=4;craft(w,r,workshop.id,'bread');assert.equal(r.inventory.bread,2);const hunger=r.hunger;
 assert.ok(submitPlan(w,{id:'eat-new-food',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'吃自己做的食物',actions:[{type:'eat',item:'bread'}]}).ok);stepWorld(w,5);assert.equal(r.inventory.bread,1);assert.ok(r.hunger<hunger||r.hunger<1);
});
test('gathering surface rock cannot leave the same surface mineral available twice',()=>{
 const {w,r,home}=fixture();craft(w,r,home.id,'pick');work(w,r,{operation:'equip',tool:'pick'});const mine=w.industry!.mines[0];w.resources[0].amount=0;assert.ok(industryTarget(w,r,{type:'industry',operation:'mine',mineId:mine.id}).error);
});
test('actual mining depletes geology and wears tools; deepening needs support and upgraded equipment',()=>{
 const {w,r,home}=fixture();craft(w,r,home.id,'pick');work(w,r,{operation:'equip',tool:'pick'});const mine=w.industry!.mines[0],tool=w.industry!.tools[0];work(w,r,{operation:'mine',mineId:mine.id});assert.equal(mine.remaining[0],5);assert.equal(w.resources[0].amount,5);assert.equal(r.inventory.ore,1);assert.equal(tool.durability,29);assert.ok(industryTarget(w,r,{type:'industry',operation:'deepen',mineId:mine.id}).error);
});
test('fishing is restricted to an actual shore, equipped tool and finite renewable fish population',()=>{
 const {w,r,home}=fixture();craft(w,r,home.id,'fiber');craft(w,r,home.id,'rod');work(w,r,{operation:'equip',tool:'rod'});r.at={x:29,y:10};work(w,r,{operation:'fish',at:{x:29,y:10}});assert.equal(r.inventory.fish,1);assert.equal(w.industry!.tools[0].durability,29);const pond=w.industry!.fishing['0,0'];assert.equal(pond.amount,11);pond.amount=0;assert.ok(industryTarget(w,r,{type:'industry',operation:'fish',at:{x:29,y:10}}).error);w.minute+=10*DAY;advanceIndustry(w);assert.equal(pond.amount,12);
});
test('orchards use real plot rights and seedlings; cutting an unripe seedling cannot multiply wood',()=>{
 const {w,r,home}=fixture();craft(w,r,home.id,'sapling');work(w,r,{operation:'plantTree',plotId:'field'});const t=w.industry!.trees[0];assert.equal(t.status,'growing');assert.ok(productionTarget(w,r,{type:'production',operation:'plantCrop',plotId:'field',cropId:'crop/turnip@2'}).error);const wood=r.inventory.wood!;work(w,r,{operation:'cutTree',treeId:t.id});assert.equal(r.inventory.wood,wood+1);assert.equal(t.status,'cut');
});
test('trees grow only through actual tended time and mature before seasonal fruit can be harvested',()=>{
 const {w,r,home}=fixture();craft(w,r,home.id,'sapling');work(w,r,{operation:'plantTree',plotId:'field'});const t=w.industry!.trees[0];t.growth=28*DAY-1;t.lastWateredDay=Math.floor(w.minute/DAY);w.minute++;advanceIndustry(w);assert.equal(t.status,'mature');t.fruit=3;work(w,r,{operation:'harvestFruit',treeId:t.id});assert.equal(r.inventory.fruit,3);assert.equal(t.fruit,0);
});
test('animal ownership, finite barn capacity, actual feed and sex determine real products',()=>{
 const {w,r,barn}=fixture();stockCrates(w,r,'chickCrate',2);work(w,r,{operation:'placeAnimal',buildingId:barn.id,kind:'chicken'});work(w,r,{operation:'placeAnimal',buildingId:barn.id,kind:'chicken'});const female=w.industry!.animals.find(n=>n.sex==='female')!,male=w.industry!.animals.find(n=>n.sex==='male')!;assert.ok(female);assert.ok(male);r.inventory.fodder=1;female.hunger=70;work(w,r,{operation:'feedAnimal',animalId:female.id});assert.ok(female.hunger<25);assert.ok(w.minute-female.bornAt<28*DAY);assert.equal(female.product,0);female.bornAt=male.bornAt=w.minute-28*DAY;female.lastMinute=w.minute;male.lastMinute=w.minute;w.minute+=DAY;advanceIndustry(w);assert.equal(female.product,1);assert.equal(male.product,0);work(w,r,{operation:'collectAnimal',animalId:female.id});assert.equal(r.inventory.egg,1);assert.equal(female.product,0);
});
test('livestock birth preserves a new identity and does not wait for an observer',()=>{
 const {w,r,barn}=fixture();stockCrates(w,r,'goatCrate',2);work(w,r,{operation:'placeAnimal',buildingId:barn.id,kind:'goat'});work(w,r,{operation:'placeAnimal',buildingId:barn.id,kind:'goat'});const mother=w.industry!.animals.find(n=>n.sex==='female')!,father=w.industry!.animals.find(n=>n.sex==='male')!;work(w,r,{operation:'breedAnimal',animalId:mother.id,partnerId:father.id});w.minute=mother.pregnancy!.dueAt;mother.hunger=mother.thirst=0;mother.health=100;mother.lastMinute=w.minute;father.lastMinute=w.minute;advanceIndustry(w);const baby=w.industry!.animals.at(-1)!;assert.equal(w.industry!.animals.length,3);assert.equal(baby.bornAt,w.minute);assert.notEqual(baby.id,mother.id);advanceIndustry(w);assert.equal(w.industry!.animals.length,3);
});
test('unfed livestock can die and existing ownership never appoints a new caretaker automatically',()=>{
 const {w,r,barn}=fixture();stockCrates(w,r,'goatCrate',1);work(w,r,{operation:'placeAnimal',buildingId:barn.id,kind:'goat'});const n=w.industry!.animals[0];n.health=.001;n.hunger=n.thirst=100;w.minute++;advanceIndustry(w);assert.equal(n.status,'dead');assert.equal(w.industry!.totals.animalDeaths,1);assert.equal(w.residents[1].plan,null);
});
test('greenhouse season protection still needs a real building, seeds, water and time',()=>{
 const {w,r,house}=fixture();work(w,r,{operation:'plantHouse',buildingId:house.id,bed:0,cropId:'crop/turnip@2'});const bed=w.industry!.beds[0];assert.ok(bed.crop);const seed=r.inventory.seed;assert.ok(industryTarget(w,r,{type:'industry',operation:'plantHouse',buildingId:house.id,bed:0,cropId:'crop/turnip@2'}).error);bed.crop!.growth=4;work(w,r,{operation:'harvestHouse',buildingId:house.id,bed:0});assert.equal(bed.crop,null);assert.equal(r.inventory.turnip,52);assert.equal(r.inventory.seed,seed);
});
test('new material goods and equipped tools survive death and actual inheritance acceptance',()=>{
 const {w,r,heir,home}=fixture();r.inventory.bar=3;craft(w,r,home.id,'pick');work(w,r,{operation:'equip',tool:'pick'});const tool=w.industry!.tools[0];tool.durability=7;recordDeath(w,r);advanceIndustry(w);heir.at={...home.door};assert.equal(completeProduction(w,heir,{type:'production',operation:'inherit',personId:r.id}),null);assert.equal(heir.inventory.bar??0,0);assert.equal(ownedEstateParcels(w,heir).reduce((n,p)=>n+(p.inventory.bar??0),0),3);assert.ok(tool.location);heir.at={x:home.door.x+4,y:home.door.y};assert.ok(completeIndustry(w,heir,{type:'industry',operation:'collectTool',toolId:tool.id}));work(w,heir,{operation:'collectTool',toolId:tool.id});assert.equal(tool.location,null);assert.equal(tool.ownerId,heir.id);assert.equal(tool.durability,7);assert.ok(industryAssets(w,heir.id).includes(tool.id));
});
test('new crops use their own outputs and fiber cannot be silently sold as food',()=>{
 const {w,r}=fixture();const p=w.plots[0];p.crop={definition:'crop/flax@1',planted:w.minute-6*DAY,growth:5,wateredDay:0,lastGrowthDay:0};r.at={...p.at};const turnip=r.inventory.turnip;
 assert.ok(submitPlan(w,{id:'harvest-fiber',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'收获纤维作物',actions:[{type:'harvest',plotId:p.id}]}).ok);stepWorld(w,10);assert.equal(r.inventory.fiber,8);assert.equal(r.inventory.turnip,turnip);
});
test('the model can choose among real production paths and only edit its own offered work duration',()=>{
 const {w,r}=fixture();const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>c.action.type==='industry'&&c.action.operation==='craft')!;assert.ok(choice);const answer=parseChoice(JSON.stringify({choice:choice.id,minutes:30}),menu);assert.equal((answer.actions[0] as IndustryAction).minutes,30);assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,recipeId:'bar'}),menu));
});
test('repair retains the exact broken tool and mining actions bind their selected layer',()=>{
 const {w,r,workshop,home}=fixture();craft(w,r,home.id,'pick');work(w,r,{operation:'equip',tool:'pick'});const tool=w.industry!.tools[0];tool.durability=0;work(w,r,{operation:'install',buildingId:workshop.id,station:'bench'});const before={...r.inventory};work(w,r,{operation:'repairTool',buildingId:workshop.id,tool:'pick'});assert.equal(w.industry!.tools.length,1);assert.equal(tool.durability,30);assert.equal(r.inventory.wood,before.wood!-2);const m=w.industry!.mines[0],a:IndustryAction={type:'industry',operation:'mine',mineId:m.id};assert.equal(industryTarget(w,r,a).error,undefined);assert.equal(a.depth,0);m.depth=1;tool.level=2;assert.match(industryTarget(w,r,a).error!,/矿层已/);
});
test('heavy machinery cannot occupy the shared lodge and canonical pens do not move after a death',()=>{
 const {w,r,barn,hall}=fixture();assert.ok(industryTarget(w,r,{type:'industry',operation:'install',buildingId:hall.id,station:'forge'}).error);stockCrates(w,r,'chickCrate',2);work(w,r,{operation:'placeAnimal',buildingId:barn.id,kind:'chicken'});work(w,r,{operation:'placeAnimal',buildingId:barn.id,kind:'chicken'});const [first,second]=w.industry!.animals,pen=second.pen;first.status='dead';w.minute++;advanceIndustry(w);assert.equal(second.pen,pen);
});
test('animal relocation picks up, walks out and follows the real outdoor route before new barn delivery',()=>{
 const {w,r,barn}=fixture();const next={...barn,id:'second-barn',at:{x:15,y:22},door:{x:18,y:27}};w.buildings.push(next);r.knownBuildings.push(next.id);stockCrates(w,r,'chickCrate',1);work(w,r,{operation:'placeAnimal',buildingId:barn.id,kind:'chicken'});const animal=w.industry!.animals[0];const oldBarn=animal.barnId;r.at={...barn.door};r.inside=null;r.roomAt=null;
 const a:IndustryAction={type:'industry',operation:'moveAnimal',animalId:animal.id,buildingId:next.id};assert.ok(submitPlan(w,{id:'real-animal-escort',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'亲自迁移动物',actions:[a]}).ok);let guard=300;while(!animal.carrierId){assert.ok(guard--);stepWorld(w,1);}assert.equal(animal.barnId,oldBarn);assert.equal(animal.inside,barn.id);assert.deepEqual(animal.roomAt,r.roomAt);while(r.activity||r.plan){assert.ok(guard--);stepWorld(w,1);}assert.equal(r.lastFailure,null);assert.equal(animal.barnId,next.id);assert.equal(animal.carrierId,null);assert.equal(animal.at,undefined);assert.equal(r.inside,next.id);
});

test('a working batch keeps its original executable recipe after a new version changes materials, duration and output',()=>{const {w,r,home}=fixture(),opening={...r.inventory};craft(w,r,home.id,'axe',20);const first=w.industry!.batches[0],old=first.definition;const alias='recipe/industry/axe',next=structuredClone(w.definitions[alias+'@1']);next.version=2;next.cost={wood:9,stone:7};next.minutes=90;next.data={...next.data,input:{wood:9,stone:7},minutes:90,output:{axeKit:2}};w.definitions[alias+'@2']=next;w.activeDefinitions[alias]=alias+'@2';craft(w,r,home.id,'axe',25);assert.equal(first.status,'completed');assert.equal(first.definition,old);assert.equal(first.worked,45);assert.equal(r.inventory.axeKit,1);assert.equal(r.inventory.wood,opening.wood!-3);craft(w,r,home.id,'axe',60);const newer=w.industry!.batches[1];assert.equal(newer.definition,alias+'@2');assert.equal(newer.worked,60);assert.equal(r.inventory.axeKit,1);craft(w,r,home.id,'axe',30);assert.equal(newer.status,'completed');assert.equal(r.inventory.axeKit,3);assert.equal(r.inventory.wood,opening.wood!-12);assert.equal(r.inventory.stone,opening.stone!-9);});
