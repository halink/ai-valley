import type {Vec,World} from './types.js';
/** Physical remains and finite estate stores cannot be buried under a new footprint. Read only. */
export function retainedOutdoorSites(w:World):Vec[]{
 const places=w.residents.filter(r=>r.status==='dead'&&r.residency!=='outside'&&!r.inside&&!w.graves.some(g=>g.personId===r.id)).map(r=>r.at);
 for(const e of w.estates){
  const person=w.residents.find(r=>r.id===e.personId),location=e.location??(person?{at:person.at,inside:person.inside,regional:person.regionalLocation}:undefined);
  if(location&&!location.inside&&!location.regional&&Object.values(e.inventory).some(n=>n!>0))places.push(location.at);
  for(const p of e.parcels??[])if(!p.location.inside&&!p.location.regional&&Object.values(p.inventory).some(n=>n!>0))places.push(p.location.at);
 }
 for(const tool of w.industry?.tools??[])if(tool.location&&!tool.location.inside&&!tool.location.regional)places.push(tool.location.at);
 for(const project of w.construction?.projects??[])if(project.claims.some(l=>l.quantity>0))places.push(project.door);
 return places;
}
