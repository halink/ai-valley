import type {Inventory,Item,World} from '../shared/types.js';
import type {InheritanceShare} from '../shared/production.js';
import {estateSplitQuantity} from './estate-custody.js';
import {foodTransaction} from './food.js';
import {routeFood} from './food-routes.js';
import {pendingEstateReturns} from './estate-pending.js';
import {hasEstateDebt} from './debt.js';

interface Branch {children:Map<string,Branch>;leaf?:InheritanceShare;previous:Record<string,number>;}
const branch=():Branch=>({children:new Map(),previous:{}});
const has=(bag:Inventory)=>Object.values(bag).some(n=>n!>0);
/** Recover omitted shop property without rewriting the original accepted distribution.
 * Original share paths retain branch proportions after an unaccepted heir's death.
 * Each new claim still requires the recipient's own inheritance action and collection. */
export function reconcileBusinessEstateSupplements(w:World,heirsFor:(id:string)=>string[]):void {
 for(const estate of w.estates){
  const saved=w.production?.inheritances[estate.personId];
  if(!saved||pendingEstateReturns(w,estate.personId)||hasEstateDebt(w,estate.personId))continue;
  const sources=(estate.parcels??[]).filter(p=>p.ownerId===estate.personId&&!p.claimId&&p.source.startsWith('business-supplement:')&&has(p.inventory));
  const businessEstate=(estate.parcels??[]).some(p=>p.source.startsWith('business-supplement:'));
  // Existing unaccepted monetary claims stay reserved and are never paid twice.
  const coins=businessEstate?Math.max(0,estate.coins-saved.shares.filter(s=>s.claimedAt===null).reduce((n,s)=>n+s.coins,0)):0;
  if(!sources.length&&!coins)continue;
  const originals=saved.shares.filter(s=>!s.id.startsWith('supplement:business:'));
  if(!originals.length)continue; // No proven recipients: keep the goods protected.
  let serial=1;while(saved.shares.some(s=>s.id.startsWith(`supplement:business:${serial}:`)))serial++;
  const root=branch(),additions:InheritanceShare[]=[];
  for(const original of originals){
   let node=root;for(const key of original.id.split('.')){if(!node.children.has(key))node.children.set(key,branch());node=node.children.get(key)!;}
   const dead=w.residents.some(p=>p.id===original.heirId&&p.status==='dead');
   const successors=dead?heirsFor(original.heirId):[];
   const recipients=successors.length?successors:[original.heirId];
   for(const [i,heirId]of recipients.entries()){
    const share:InheritanceShare={id:`supplement:business:${serial}:${original.id}:${i}`,heirId,coins:0,inventory:{},goodsClaims:[],plots:[],buildings:[],parcels:[],industryAssets:[],creditClaims:[],claimedAt:null};
    const leaf=branch();leaf.leaf=share;node.children.set('recipient:'+i,leaf);additions.push(share);
   }
  }
  const allocate=(node:Branch,item:string,n:number,receive:(share:InheritanceShare,n:number)=>void):void=>{
   if(node.leaf){receive(node.leaf,n);return;}
   const children=[...node.children.values()];
   children.forEach((child,index)=>allocate(child,item,estateSplitQuantity(n,index,children.length,node.previous[item]??0),receive));
   node.previous[item]=(node.previous[item]??0)+n;
  };
  // This transaction starts after the shop-to-estate transfer has completed. Routes
  // therefore consume real starting lots rather than chaining newly received food.
  foodTransaction(w,()=>{
   for(const source of sources){
    const portions=new Map<InheritanceShare,Inventory>();
    for(const [item,n]of Object.entries(source.inventory))allocate(root,item,n!,(share,quantity)=>{
     if(!quantity)return;let inventory=portions.get(share);if(!inventory){inventory={};portions.set(share,inventory);}
     inventory[item as Item]=quantity;share.inventory[item as Item]=(share.inventory[item as Item]??0)+quantity;
    });
    for(const [share,inventory]of portions){
     const id=source.id+':'+share.id;estate.parcels!.push({id,ownerId:estate.personId,inventory,location:structuredClone(source.location),createdAt:w.minute,source:source.source,claimId:share.id});
     share.goodsClaims!.push(id);routeFood(w,source.id,id,inventory);
    }
    source.inventory={};
   }
   allocate(root,'coins',coins,(share,n)=>{share.coins=n;});
   saved.shares.push(...additions.filter(s=>s.coins>0||has(s.inventory)));
   estate.status='protected';
  });
 }
}
