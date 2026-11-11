import type {DecisionContext} from '../shared/types.js';
import type {ActionChoice} from './affordances.js';

/** Select one already eligible self-drink, after the ordinary age/capacity and
 * transport filters. This does not inspect hidden stock, validate a new route,
 * reserve water, or choose an action on the resident's behalf. */
export function directWaterChoice(context:DecisionContext,all:ActionChoice[]):ActionChoice|undefined {
 const candidates=all.filter(c=>c.action.type==='waterSupply'&&['drink','drinkPublic'].includes(c.action.operation)).sort((a,b)=>a.id.localeCompare(b.id));
 return candidates[Math.floor(context.minute/30)%Math.max(1,candidates.length)];
}
