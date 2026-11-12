import {fishingEcologyPanel} from '../src/client/fishing-observation.js';
import {industryPanel} from '../src/client/industry.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {initializeIndustry} from '../src/world/industry.js';
import {advanceFishing} from '../src/world/fishing.js';
import {DAY,YEAR} from '../src/world/time.js';
import type {FishPool} from '../src/shared/industry.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.minute=480;w.weather='sun';
 w.map={width:64,height:32,name:'独立鱼群边界',entrance:{x:1,y:1},tiles:Array(64*32).fill('grass')};
 for(let x=4;x<=59;x++)w.map.tiles[12*64+x]='water';
 initializeIndustry(w);
 const left=w.industry!.fishing['0,0'],right=w.industry!.fishing['1,0'];
 for(const p of [left,right]){
  for(const [kind,s] of Object.entries(p.species!))Object.assign(s!,{amount:kind==='carp'&&p===left?4:0,opening:kind==='carp'&&p===left?4:0,progress:0,born:0,caught:0,eaten:0,arrived:0,departed:0});
  p.amount=p===left?4:0;p.progress=0;p.shoal!.nextMoveAt=Number.MAX_SAFE_INTEGER;p.shoal!.activity='feeding';
 }
 return {w,left,right};
}
function ledger(p:FishPool){
 assert.equal(p.amount,Object.values(p.species!).reduce((sum,s)=>sum+s!.amount,0));
 assert.ok(p.amount>=0&&p.amount<=12);
 for(const s of Object.values(p.species!)){
  assert.equal(s!.amount,s!.opening+s!.born+s!.arrived-s!.departed-s!.caught-s!.eaten);
  assert.ok(Number.isInteger(s!.amount)&&s!.amount>=0);
 }
}

test('independent review: an intermediate active flood blocks migration with dry endpoints',()=>{
 const {w,left,right}=fixture();
 w.frontierHazards={beasts:[],shore:null,woodland:{x:1,y:1},nextDisasterAt:Infinity,nextSerial:1,foodPatches:[],nextBeastSerial:1,totals:{injuries:0,accidentalDeaths:0,damagedBuildings:0,damagedPlots:0,repairs:0,livestockAttacks:0,livestockKilled:0,wildlifeDeaths:0,hunted:0},disasters:[{id:'review-current',kind:'flashFlood',at:{x:31,y:12},radius:0,phase:'active',warningAt:0,startsAt:0,endsAt:10*DAY,intensity:2,warned:[],exposure:{}}]};
 w.minute+=DAY;advanceFishing(w);
 assert.equal(left.species!.carp!.departed,0);assert.equal(right.amount,0);ledger(left);ledger(right);
 w.frontierHazards!.disasters=[];w.minute+=DAY;advanceFishing(w);
 assert.equal(left.species!.carp!.departed,1);assert.equal(right.species!.carp!.arrived,1);ledger(left);ledger(right);
});

test('independent review: two full years retain per-species ledger and repeat advancement is idempotent',()=>{
 const {w,left,right}=fixture();
 for(let day=0;day<2*YEAR/DAY;day++){
  w.minute+=DAY;advanceFishing(w);ledger(left);ledger(right);
  const before=structuredClone(w.industry!.fishing);advanceFishing(w);assert.deepEqual(w.industry!.fishing,before);
 }
});

test('independent review: dry barrier prevents transfer between adjacent registered sectors',()=>{
 const {w,left,right}=fixture();
 w.map.tiles[12*64+31]='grass';
 w.minute+=DAY;advanceFishing(w);
 assert.equal(right.amount,0);assert.equal(left.species!.carp!.departed,0);ledger(left);ledger(right);
});

// Unlike the three ecology baseline checks above, these observation cases fail
// against the former hard-coded capacity / pooled-progress industry panel.
function freezeTree(value:object){for(const child of Object.values(value))if(child&&typeof child==='object'&&!Object.isFrozen(child))freezeTree(child);Object.freeze(value);}
test('independent observation: a half-full capacity-24 pool remains visible and reading cannot mutate the world',()=>{
 const {w,left}=fixture();w.industry!.fishing={'0,0':left};
 const definition=structuredClone(w.definitions[left.definition!]);definition.version=2;definition.data.capacity=24;
 w.definitions['ecology/fishing-process@2']=definition;left.definition='ecology/fishing-process@2';left.amount=12;
 const stocks=Object.values(left.species!);for(const s of stocks)Object.assign(s!,{amount:3,opening:3});
 const before=JSON.stringify(w);freezeTree(w);const html=industryPanel(w);
 assert.match(html,/实际种群\s*12\s*\/\s*24/);assert.equal(JSON.stringify(w),before);
});

test('independent observation: missing bound definition remains unknown without silently registering defaults',()=>{
 const {w,left}=fixture();w.industry!.fishing={'0,0':left};left.definition='ecology/fishing-process@404';
 delete w.definitions['ecology/fishing-process@1'];
 const before=JSON.stringify(w);freezeTree(w);const html=industryPanel(w);
 assert.match(html,/容量[^<。]*未知|未知[^<。]*容量/);assert.equal(JSON.stringify(w),before);
});

test('independent observation: explicit null capacity is unknown rather than a default twelve',()=>{
 const {w,left}=fixture();w.industry!.fishing={'0,0':left};
 w.definitions[left.definition!].data.capacity=null;
 const before=JSON.stringify(w);freezeTree(w);const html=fishingEcologyPanel(w);
 assert.match(html,/容量未知/);assert.equal(JSON.stringify(w),before);
});

test('independent observation: untrusted saved sector keys are escaped and an extinct species remains visible at capacity',()=>{
 const {w,left}=fixture();const key='<img src=x onerror="alert(1)">';w.industry!.fishing={[key]:left};
 for(const s of Object.values(left.species!))Object.assign(s!,{amount:0,opening:0});
 Object.assign(left.species!.bream!,{amount:12,opening:12});left.amount=12;
 const before=JSON.stringify(w);freezeTree(w);const html=fishingEcologyPanel(w);
 assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
 assert.doesNotMatch(html,/<img/);assert.match(html,/河鲤 0 份 · 已耗尽，不能自行繁殖/);
 assert.equal(JSON.stringify(w),before);
});
