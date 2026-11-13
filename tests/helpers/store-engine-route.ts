/** Explicit synthetic building fixture, ordinary-engine movement and commerce. Never a real save. */
import {createFormalWorld} from '../../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../../src/world/engine.js';
import type {Action,Building,Resident,Snapshot,Vec} from '../../src/shared/types.js';

export function storeEngineRoute(){
 const world=createFormalWorld(5402),person=world.residents.find(r=>r.id==='founder-1-1')!,buyer=world.residents.find(r=>r.id==='founder-1-2')!;
 const home=world.buildings.find(b=>b.id===person.homeId)!,buyerHome=world.buildings.find(b=>b.id===buyer.homeId)!;
 const snapshots:Snapshot[]=[],labels:string[]=[],plans:Array<{actorId:string;action:Action;start:number;end:number}>=[];
 const capture=(label:string)=>{labels.push(label);snapshots.push({world:structuredClone(world),mapRevision:world.id,serverTime:'synthetic-offline-store',version:'synthetic-engine-store-route',capabilities:{active:[],pending:[]}});};
 capture('original-seed');
 // Formal seeds have no store. Explicitly place one test building on the owner's existing
 // registered build parcel, using the actual versioned store definition. Do not seed a
 // business, room coordinates, resident knowledge, money, goods, stations or transactions.
 const parcel=(world.definitions['land/start@1'].data.parcels as Array<Vec&{ownerId:string}>).find(p=>p.ownerId===person.id)!;
 const definition=world.activeDefinitions['building/store'],data=world.definitions[definition].data;
 const building:Building={id:'synthetic-store-1',name:'合成观察商店',kind:'store',at:{x:parcel.x,y:parcel.y},width:Number(data.width),height:Number(data.height),capacity:Number(data.capacity),ownerId:person.id,residents:[],condition:100,definition,door:{x:parcel.x+Math.floor(Number(data.width)/2),y:parcel.y+Number(data.height)}};
 world.buildings.push(building);world.clock.paused=false;capture('fixture');
 const run=(label:string,actor:Resident,action:Action)=>{
  const start=world.minute,result=submitPlan(world,{id:`store-route:${plans.length}`,actorId:actor.id,actorRevision:actor.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'Explicit offline synthetic store route; not autonomous model behavior',actions:[action]});
  if(!result.ok)throw new Error(label+': '+result.error);
  let count=0,onSite=false;
  while(actor.plan||actor.activity){
   if(++count>2400)throw new Error('store_route_timeout:'+label);
   const inside=actor.inside;stepWorld(world,.25);
   if(actor.lastFailure)throw new Error(label+': '+actor.lastFailure);
   if(inside!==actor.inside)capture(label+(actor.inside?':entered':':exited'));
   const activity=actor.activity;
   if(!onSite&&activity&&!activity.path.length&&!activity.room?.path.length&&activity.room?.mode!=='exit'){
    capture(label+':on-site');onSite=true;
   }
   if(onSite&&activity&&activity.remaining>0&&activity.remaining<1&&!labels.includes(label+':before-completion'))capture(label+':before-completion');
  }
  plans.push({actorId:actor.id,action:structuredClone(action),start,end:world.minute});capture(label+':completed');
 };
 run('approach',person,{type:'move',to:{...building.door}});
 run('open',person,{type:'economy',operation:'open',buildingId:building.id,name:'合成路线小铺'});
 const business=world.economy!.businesses.find(b=>b.buildingId===building.id)!;
 run('stock',person,{type:'economy',operation:'stock',businessId:business.id,item:'berry',quantity:2});
 run('list',person,{type:'economy',operation:'list',businessId:business.id,item:'berry',quantity:2,price:3});
 const listing=world.economy!.listings.find(l=>l.businessId===business.id)!;
 run('enter',person,{type:'design',operation:'draw',buildingId:building.id,kind:'tool',drawing:{kind:'tool',name:'合成路线斧具图纸',purpose:'验证实际桌台进出，不制作道具',tool:'axe',frame:'wood',fitting:'stone',reinforcement:0}});
 run('wait',person,{type:'wait',minutes:2});
 run('exit',person,{type:'move',to:{...home.door}});
 run('buyer-approach',buyer,{type:'move',to:{...building.door}});
 run('buy',buyer,{type:'economy',operation:'buy',listingId:listing.id,buildingId:building.id,item:'berry',quantity:1,maxTotal:3});
 run('buyer-exit',buyer,{type:'move',to:{...buyerHome.door}});
 return {snapshots,labels,plans,personId:person.id,buyerId:buyer.id,buildingId:building.id,businessId:business.id,listingId:listing.id,
  provenance:'createFormalWorld(5402), explicitly added synthetic store@1 building on original owner parcel and unpaused; original residents, money and inventory unchanged in fixture setup; submitPlan/stepWorld alone produce discovery, room coordinates, drawing, business, stock, listing, outdoor settlement and exit. No seeded transaction or product. Scripted synthetic, not autonomous model behavior or original-seed store construction.'};
}
