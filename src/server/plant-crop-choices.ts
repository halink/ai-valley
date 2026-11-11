import type {DecisionContext} from '../shared/types.js';
import type {ActionChoice} from './affordances.js';

function identity(choice:ActionChoice):string|null {
 const a=choice.action;
 return a.type==='production'&&a.operation==='plantCrop'&&a.plotId&&a.cropId?JSON.stringify([a.plotId,a.cropId]):null;
}

/** Only use candidates surviving the existing age, journey and permission
 * filters. Legacy IDs omit cropId, so rotate complete plot/crop identities. */
export function plantCropChoice(c:DecisionContext,all:ActionChoice[]):ActionChoice|undefined {
 const candidates=new Map<string,ActionChoice>();
 for(const choice of all){const key=identity(choice);if(key&&!candidates.has(key))candidates.set(key,choice);}
 const ordered=[...candidates].sort(([a],[b])=>a.localeCompare(b)).map(([,choice])=>choice);
 return ordered.length?ordered[Math.floor(c.minute/30)%ordered.length]:undefined;
}

/** Keep the old overview intact. Restore the selected variety even when a
 * different crop is already visible, preventing the ordinary rotation from
 * starving part of the crop vocabulary. At most one extra row is possible. */
export function restorePlantCropChoice(plant:ActionChoice|undefined,choices:ActionChoice[],ordinaryLimit:number):ActionChoice[]{
 if(!plant||choices.some(choice=>identity(choice)===identity(plant)))return choices;
 const result=[...choices],reflections=result.map((choice,index)=>({choice,index})).filter(({choice})=>choice.action.type==='agency'&&choice.action.operation==='reflect');
 if(result.length>=ordinaryLimit&&reflections.length>1)result[reflections.at(-1)!.index]=plant;
 else result.push(plant);
 return result;
}
