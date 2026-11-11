import type {EstateParcel,Item,World} from '../shared/types.js';
import type {Livestock,OrchardTree} from '../shared/industry.js';
import {goods,itemKeys} from '../shared/items.js';
import {observesFoodOwnership,type FoodOwnershipAmount,type FoodOwnershipStock} from './food-consumption-evidence.js';

const edible=itemKeys.filter(item=>goods[item].food>0);
const data=(o:unknown,key:string):unknown=>o&&typeof o==='object'?Object.getOwnPropertyDescriptor(o,key)?.value:undefined;
const plain=(o:unknown):o is object=>!!o&&typeof o==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const owner=(value:unknown):string|null=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/.test(value)?value:null;
const quantity=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;

/** No foodContainers/initialization/ledger reads. An alias is not another proved
 * physical holding, even if its current quantities happen to match. */
function aliases(w:World){
 const ids=new Map<string,number>(),objects=new Map<object,number>();
 const add=(id:string,value:unknown)=>{ids.set(id,(ids.get(id)??0)+1);if(value&&typeof value==='object')objects.set(value,(objects.get(value)??0)+1);};
 for(const r of w.residents)add('person:'+r.id,r.inventory);
 for(const c of w.migration?.contacts??[])if(c.person)add('person:'+c.id,c.person.inventory);
 for(const m of w.foreignTrade?.merchants??[])add('person:'+m.id,m.person.inventory);
 for(const e of w.estates){add('estate:'+e.personId,e.inventory);for(const p of e.parcels??[])add(p.id,p.inventory);}
 for(const b of w.economy?.businesses??[])add('business:'+b.id,b.inventory);
 for(const l of w.economy?.listings??[])if(l.side==='sale'&&l.status==='open')add('listing:'+l.id,l);
 for(const [id,bag]of Object.entries(w.civic?.stores??{}))add('public:'+id,bag);
 for(const p of w.civic?.reserves??[])add('public-reserve:'+p.id,p.inventory);
 for(const p of w.household?.pools??[])for(const c of p.credits)add('family-stock:'+p.id+':'+c.ownerId,c.inventory);
 for(const g of w.household?.gifts??[])if(g.status==='ready')for(const c of g.segments)add('family-gift:'+g.id+':'+c.ownerId,c.inventory);
 for(const e of w.culture?.events??[]){add('culture-prep:'+e.id,e.preparation.held);for(const c of e.contributions)add('culture-food:'+e.id+':'+c.id,c.inventory);}
 for(const b of w.industry?.batches??[])if(b.status==='working')add('craft:'+b.id,b.input);
 for(const c of w.employment?.contracts??[])if(c.batch)add('employment:'+c.id,c.batch.inventory);
 // Include duplicate/cut/empty asset references too: a colliding identity cannot
 // prove which object a later food ledger or snapshot names.
 for(const t of w.industry?.trees??[])add('orchard-stock:'+t.id,t);
 for(const a of w.industry?.animals??[])add('animal-stock:'+a.id,a);
 for(const d of w.outsideAid?.deliveries??[])add('aid:'+d.id,d.inventory);
 for(const o of w.foreignTrade?.offers??[])add('offer:'+o.id,o);
 for(const s of w.foreignTrade?.shipments??[])add('shipment:'+s.id,s);
 return (id:string,value:unknown)=>(ids.get(id)??0)>1||!!value&&typeof value==='object'&&(objects.get(value)??0)>1;
}

/** Created after prepareShares, but quantities are read by the callbacks at each
 * real ownerId assignment. Newly split lots are still in the outer transaction's
 * pending routes. We deliberately never claim their batch or nutrition facts. */
export function inheritedFoodOwnership(w:World,toOwnerId:string){
 if(!observesFoodOwnership(w))return;
 const ambiguousAlias=aliases(w),stocks:FoodOwnershipStock[]=[],byId=new Map<string,FoodOwnershipStock>();
 const add=(containerType:FoodOwnershipStock['containerType'],container:string,from:unknown,value:unknown,entries:Array<[Item,number|null]>)=>{
  const fromOwnerId=owner(from),ambiguous=fromOwnerId===null||ambiguousAlias(container,value);
  // Proven zeros do not represent an existing food quantity, even if a separate
  // alias is ambiguous. Invalid or absent scalar stock remains unknown.
  const amounts:FoodOwnershipAmount[]=entries.filter(([,q])=>q!==0).map(([item,q])=>({item,quantity:ambiguous?null:q,nutrition:null,lots:null}));
  if(!amounts.length)return;
  const prior=byId.get(container);
  if(prior){
   prior.ambiguous=true;if(prior.fromOwnerId!==fromOwnerId)prior.fromOwnerId=null;
   for(const amount of amounts)if(!prior.amounts.some(a=>a.item===amount.item))prior.amounts.push(amount);
   for(const amount of prior.amounts)amount.quantity=null;
   return;
  }
  const stock={containerType,container,fromOwnerId,toOwnerId,ambiguous,amounts};byId.set(container,stock);stocks.push(stock);
 };
 return {stocks,
  parcel:(p:EstateParcel)=>{
   const bag=data(p,'inventory');
   add('estate-stock',p.id,data(p,'ownerId'),bag,edible.map(item=>{
    const d=plain(bag)?Object.getOwnPropertyDescriptor(bag,item):undefined;
    return [item,!plain(bag)?null:!d?0:'value'in d?quantity(d.value):null];
   }));
  },
  industry:(stock:OrchardTree|Livestock,type:'orchard-stock'|'animal-stock')=>{
   if(type==='orchard-stock'){
    if(data(stock,'status')==='cut')return;
    add(type,type+':'+stock.id,data(stock,'ownerId'),stock,[['fruit',quantity(data(stock,'fruit'))]]);
   }else{
    const kind=data(stock,'kind'),item=kind==='chicken'?'egg':kind==='duck'?'duckEgg':kind==='goat'||kind==='cow'?'milk':null;
    if(item)add(type,type+':'+stock.id,data(stock,'ownerId'),stock,[[item,quantity(data(stock,'product'))]]);
   }
  },
 };
}
