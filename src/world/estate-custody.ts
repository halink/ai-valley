import {routeFood} from './food-routes.js';
import {roomLayout} from '../shared/rooms.js';
import type {EstateParcel,Inventory,Resident,Vec,World} from '../shared/types.js';
export interface EstateLocation {at:Vec;inside:string|null;roomAt:Vec|null;label?:string;}
const has=(bag:Inventory)=>Object.values(bag).some(n=>n!>0);
/** A sealed stock remains where it was last physically held. Financial accounts are separate. */
export function initializeEstateCustody(w:World){for(const e of w.estates){e.parcels??=[];if(!e.location){const p=w.residents.find(r=>r.id===e.personId),fact=w.events.find(t=>t.kind==='death'&&t.actors[0]===e.personId),body=fact?.bodyLocation;e.location={at:{...(body?.at??fact?.place??p?.at??w.map.entrance)},inside:body?.roomId??fact?.roomId??p?.inside??null,roomAt:body?.roomAt?{...body.roomAt}:fact?.roomAt?{...fact.roomAt}:p?.roomAt?{...p.roomAt}:null,label:'逝者随身物品原址封存'};}}}
export function estateLocation(at:Vec,inside:string|null=null,roomAt:Vec|null=null,label?:string):EstateLocation{return {at:{...at},inside,roomAt:roomAt?{...roomAt}:null,label};}
export function estateStock(w:World,id:string,source:string,location:EstateLocation):Inventory|undefined{initializeEstateCustody(w);const e=w.estates.find(e=>e.personId===id);if(!e)return;const key='estate-stock:'+id+':'+source;let p=e.parcels!.find(p=>p.id===key);if(!p){p={id:key,ownerId:id,inventory:{},location:structuredClone(location),createdAt:w.minute,source,claimId:null};e.parcels!.push(p);}return p.inventory;}
export function estateParcels(w:World):EstateParcel[]{return w.estates.flatMap(e=>e.parcels??[]);}
export function estateGoods(w:World,id:string):Inventory {const goods:Inventory={};const e=w.estates.find(e=>e.personId===id);for(const bag of [e?.inventory,...estateParcels(w).filter(p=>p.ownerId===id).map(p=>p.inventory)])if(bag)for(const [i,n]of Object.entries(bag))goods[i as keyof Inventory]=(goods[i as keyof Inventory]??0)+n!;return goods;}
/** Splitting a physical lot changes its legal shares, never its site or food age. Caller owns the food transaction. */
export function splitEstateParcels(w:World,dead:string,heirs:string[],shareIds:string[],only?:string[]):string[][] {
 initializeEstateCustody(w);const result=heirs.map(()=>[] as string[]),e=w.estates.find(e=>e.personId===dead)!;
 const root=!only&&has(e.inventory)?{id:'estate:'+dead,ownerId:dead,inventory:e.inventory,location:e.location!,source:'personal',claimId:null}:null;
 const stocks=[...(root?[root]:[]),...estateParcels(w).filter(p=>p.ownerId===dead&&(only?only.includes(p.id):!p.claimId)&&has(p.inventory))];
 for(const p of stocks){const original={...p.inventory};if(p===root)e.inventory={};else p.inventory={};for(let index=0;index<heirs.length;index++){const inventory:Inventory={};for(const [i,n]of Object.entries(original)){const quantity=Math.floor(n!/heirs.length)+(index<n!%heirs.length?1:0);if(quantity)inventory[i as keyof Inventory]=quantity;}if(!has(inventory))continue;const parcel:EstateParcel={id:p.id+':share:'+shareIds[index],ownerId:dead,inventory,location:structuredClone(p.location),createdAt:w.minute,source:p.source,claimId:shareIds[index]};e.parcels!.push(parcel);routeFood(w,p.id,parcel.id,inventory);result[index].push(parcel.id);}}

 return result;
}
export function acceptEstateParcels(w:World,ids:string[],ownerId:string){for(const p of estateParcels(w))if(ids.includes(p.id)){p.ownerId=ownerId;p.claimId=null;}}
export function ownedEstateParcels(w:World,r:Resident){return estateParcels(w).filter(p=>p.ownerId===r.id&&!p.claimId&&has(p.inventory));}
export function estateParcel(w:World,id?:string){return estateParcels(w).find(p=>p.id===id);}
export function atEstateLocation(r:Resident,location:EstateLocation){if(r.inside!==location.inside)return false;const a=r.inside?r.roomAt:r.at,b=r.inside?location.roomAt:location.at;return !!a&&!!b&&Math.abs(a.x-b.x)+Math.abs(a.y-b.y)<=1;}

export function estateBuildingLocation(w:World,id:string,label:string,indoor=false,station?:string):EstateLocation{const b=w.buildings.find(b=>b.id===id);if(!b)throw new Error('estate_missing_source_building');const layout=roomLayout(w,b);return estateLocation(b.door,indoor?b.id:null,indoor?(layout.slots.find(s=>s.key===(station?'station:'+station:'table'))?.at??layout.entry):null,label);}

export function atEstateParcel(r:Resident,p:EstateParcel){return atEstateLocation(r,p.location);}
