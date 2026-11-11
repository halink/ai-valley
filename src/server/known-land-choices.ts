import type {DecisionContext,Vec} from '../shared/types.js';
import type {ActionChoice} from './affordances.js';

const samePoint=(a:Vec,b:Vec)=>a.x===b.x&&a.y===b.y;
const identity=(p:DecisionContext['knownLand'][number])=>JSON.stringify([p.id,p.at.x,p.at.y]);

/** One address per 30-minute window, not a crop-care policy. Only known title
 * and coordinates participate: no remote crops, water, weather or route query.
 * Filter current/invalid addresses before rotating so they cannot waste a slot. */
export function knownLandChoice(c:DecisionContext):ActionChoice|undefined {
 const valid=(at:Vec)=>Number.isSafeInteger(at.x)&&Number.isSafeInteger(at.y)&&at.x>=0&&at.y>=0&&at.x<c.bounds.width&&at.y<c.bounds.height;
 if(!valid(c.actor.at)||!Number.isFinite(c.minute)||c.minute<0)return;
 const unique=new Map<string,DecisionContext['knownLand'][number]>();
 for(const p of c.knownLand)if(p.id&&valid(p.at)&&!samePoint(p.at,c.actor.at))unique.set(identity(p),p);
 const ordered=[...unique].sort(([a],[b])=>a.localeCompare(b)).map(([,p])=>p);
 if(!ordered.length)return;
 const p=ordered[Math.floor(c.minute/30)%ordered.length];
 return {id:'move.'+p.id,label:`去自己已知的田地(${p.at.x},${p.at.y})看看；田况与路况到场核实，到场后另行决定是否劳作`,action:{type:'move',to:{...p.at}}};
}
export function sameKnownLandChoice(a:ActionChoice,b:ActionChoice){
 return a.id===b.id&&a.action.type==='move'&&b.action.type==='move'&&samePoint(a.action.to,b.action.to);
}

/** Accept only the already-filtered candidate. No second rotation or action
 * synthesis here. Never replace survival, refusal, emergency or stop choices. */
export function restoreKnownLandChoice(field:ActionChoice|undefined,choices:ActionChoice[],ordinaryLimit:number):ActionChoice[]{
 if(!field||choices.some(choice=>sameKnownLandChoice(choice,field)))return choices;
 const result=[...choices],reflections=result.map((choice,index)=>({choice,index})).filter(({choice})=>choice.action.type==='agency'&&choice.action.operation==='reflect');
 if(result.length>=ordinaryLimit&&reflections.length>1)result[reflections.at(-1)!.index]=field;
 else result.push(field);
 return result;
}
