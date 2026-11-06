import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {activateExtension,migrateBuilding,registerDefinition,type ExtensionPlan,type BuildingMigration} from '../src/world/content.js';
import type {ContentDefinition} from '../src/shared/types.js';

test('registered content versions are immutable and existing buildings keep their bound version',()=>{
 const w=createWorld(),b=w.buildings[0],old=b.definition;
 const next={...structuredClone(w.definitions[old]),version:2,cost:{wood:30,stone:12}};
 assert.equal(registerDefinition(w,next).ok,true);assert.equal(b.definition,old);
 assert.equal(registerDefinition(w,{...next,cost:{wood:1}}).ok,false);assert.equal(w.definitions['building/home@2'].cost!.wood,30);
});
test('extension checks current stock, actual consumption and activation revision, not launch stock',()=>{
 const w=createWorld(),a=w.residents[0];a.inventory={wood:2};
 const definition:ContentDefinition={...structuredClone(w.definitions['building/home@1']),version:2,cost:{wood:3}};
 const p:ExtensionPlan={id:'home-method',expectedRevision:w.revision,actorId:a.id,definitions:[definition],activate:{},steps:[],required:{wood:3}};
 assert.equal(activateExtension(w,p).ok,false);assert.equal(w.definitions['building/home@2'],undefined);
 a.inventory.wood=3;w.revision++;assert.equal(activateExtension(w,p).ok,false,'stale proof must be recalculated');
 p.expectedRevision=w.revision;assert.equal(activateExtension(w,p).ok,true);assert.equal(a.inventory.wood,3,'proof never executes the plan');
 assert.equal(activateExtension(w,p).duplicate,true);
});
test('gather proof cannot reuse an already consumed source or an unreachable source',()=>{
 const w=createWorld(),a=w.residents[0];a.inventory={};
 const resource=w.resources.find(r=>r.kind==='bush'&&a.knownResources.includes(r.id))!;resource.amount=1;
 const p:ExtensionPlan={id:'fruit',expectedRevision:w.revision,actorId:a.id,definitions:[],activate:{},steps:[{kind:'gather',resourceId:resource.id,quantity:1},{kind:'gather',resourceId:resource.id,quantity:1}],required:{berry:2}};
 assert.equal(activateExtension(w,p).ok,false);
 p.steps.length=1;p.required={berry:1};for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])w.map.tiles[(resource.at.y+dy)*w.map.width+resource.at.x+dx]='water';
 assert.equal(activateExtension(w,p).ok,false);
});
test('bootstrap dependency cycles and unsupported imaginary import paths cannot be activated',()=>{
 const w=createWorld(),a=w.residents[0];a.inventory={};
 const p:ExtensionPlan={id:'cycle',expectedRevision:w.revision,actorId:a.id,definitions:[{id:'iron',version:1,kind:'recipe',dependencies:['bridge@1'],data:{}},{id:'bridge',version:1,kind:'building',dependencies:['iron@1'],data:{}}],activate:{},steps:[],required:{wood:1}};
 assert.equal(activateExtension(w,p).ok,false);assert.equal(w.definitions['iron@1'],undefined);
 p.definitions=[];p.steps=[{kind:'recipe',definition:'imaginary-import@1',count:1}];assert.equal(activateExtension(w,p).ok,false);
});
function migration(){
 const w=createWorld(),b=w.buildings[0],a=w.residents[0];
 const next={...structuredClone(w.definitions[b.definition]),version:2,cost:{wood:28,stone:12}};
 registerDefinition(w,next);
 const p:BuildingMigration={id:'upgrade',expectedRevision:w.revision,buildingId:b.id,from:b.definition,to:'building/home@2',payerId:a.id,charge:{wood:4},refund:{},consent:{actorId:a.id,buildingId:b.id,from:b.definition,to:'building/home@2',revision:w.revision,acceptedAt:w.minute}};
 return {w,a,b,p};
}
test('a caller-supplied legacy consent object cannot alter an occupied building or charge its owner',()=>{const {w,a,b,p}=migration();a.inventory.wood=8;const before=structuredClone(w);assert.equal(migrateBuilding(w,p).ok,false);assert.deepEqual(w,before);});
test('proof uses actual bound recipe yield, not an imagined activated recipe',()=>{
 const w=createWorld(),a=w.residents[0];a.inventory={turnip:2,water:1};
 const recipe:ContentDefinition={...structuredClone(w.definitions['recipe/meal@1']),version:2,data:{yield:0}};
 const routine:ContentDefinition={...structuredClone(w.definitions['action/routine@1']),version:2,dependencies:w.definitions['action/routine@1'].dependencies.map(d=>d==='recipe/meal@1'?'recipe/meal@2':d)};
 const p:ExtensionPlan={id:'yield',expectedRevision:w.revision,actorId:a.id,definitions:[recipe,routine],activate:{'action/routine':'action/routine@2','recipe/meal':'recipe/meal@2'},steps:[{kind:'recipe',definition:'recipe/meal@2',count:1}],required:{meal:1}};
 assert.equal(activateExtension(w,p).ok,false,'zero-yield recipe cannot supply one meal');
 recipe.data.yield=2;p.required={meal:2};assert.equal(activateExtension(w,p).ok,true);
 const w2=createWorld();w2.residents[0].inventory={turnip:2,water:1};p.expectedRevision=w2.revision;p.activate={'recipe/meal':'recipe/meal@2'};
 assert.equal(activateExtension(w2,p).ok,false,'active recipe without an action binding is not executable');
});
