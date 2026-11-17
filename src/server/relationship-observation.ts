import type {World,WorldEvent} from '../shared/types.js';

const perDirection=6;

/** Read the referenced experiences before the public world snapshot trims its event tail. */
export function relationshipObservation(world:World){
 const ids=new Set(world.residents.map(r=>r.id));
 const directions=new Map<string,number>();
 const sourceIds=new Set<string>();
 for(const resident of world.residents)for(const relation of resident.relations??[]){
  if(!ids.has(relation.targetId)||resident.id===relation.targetId)continue;
  directions.set(JSON.stringify([resident.id,relation.targetId]),0);
  if(relation.lastInterpretation)sourceIds.add(relation.lastInterpretation.sourceEventId);
 }
 const records:Array<Pick<WorldEvent,'id'|'at'|'text'|'interpretation'>>=[];
 let open=directions.size;
 for(let i=world.events.length-1;i>=0&&open>0;i--){
  const {id,at,kind,text,interpretation}=world.events[i];
  if(kind!=='relationship'||!interpretation)continue;
  const key=JSON.stringify([interpretation.observerId,interpretation.targetId]);
  const count=directions.get(key);
  if(count===undefined||count>=perDirection)continue;
  records.push({id,at,text,interpretation});
  sourceIds.add(interpretation.sourceEventId);
  directions.set(key,count+1);
  if(count+1===perDirection)open--;
 }
 const sources:Array<Pick<WorldEvent,'id'|'at'|'text'>>=[];
 for(let i=world.events.length-1;i>=0&&sourceIds.size>0;i--){
  const {id,at,text}=world.events[i];
  if(sourceIds.delete(id))sources.push({id,at,text});
 }
 return {records,sources};
}
