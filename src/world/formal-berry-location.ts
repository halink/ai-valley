import type {Vec,World} from '../shared/types.js';
import {inLand,reservedLandRights} from '../shared/land-rights.js';
import {disasterContains} from '../shared/frontier-hazards.js';
import {pastureContains} from './pasture.js';
import {productionParcels} from './production.js';
import {same,walkable} from './navigation.js';

export function formalBerryCommonGround(w:World){
 const reserved=reservedLandRights(w),parcels=productionParcels(w).filter(p=>p.ownerId!=='commons'),
  yards=Object.values(w.construction?.yards??{}),hazards=w.frontierHazards?.disasters.filter(d=>d.phase==='active')??[];
 const unsafe=(p:Vec)=>hazards.some(h=>disasterContains(h,p));
 const common=(p:Vec)=>!w.plots.some(plot=>same(plot.at,p))&&!w.graves.some(g=>same(g.at,p))&&
  !w.buildings.some(b=>same(b.door,p))&&!pastureContains(w,p)&&
  !reserved.some(r=>inLand({...r.at,width:r.width,height:r.height},p))&&
  !parcels.some(r=>inLand(r,p))&&!yards.some(r=>inLand(r,p))&&!unsafe(p);
 const landing=(p:Vec)=>common(p)&&walkable(w,p)&&!same(p,w.map.entrance)&&
  w.map.tiles[p.y*w.map.width+p.x]==='grass'&&!w.resources.some(r=>same(r.at,p));
 return {unsafe,common,landing};
}
