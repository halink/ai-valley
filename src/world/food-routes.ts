import type {Inventory,World} from '../shared/types.js';
export interface FoodRoute {from:string;to:string;goods:Inventory;}
const transactions=new WeakMap<World,FoodRoute[]>();
export function beginFoodRoutes(w:World){transactions.set(w,[]);}
/** Exact transfer of stocks held at the start of one atomic action. Multi-step physical handoffs use separate actions. */
export function routeFood(w:World,from:string,to:string,goods:Inventory){transactions.get(w)?.push({from,to,goods:{...goods}});}
export function finishFoodRoutes(w:World){const routes=transactions.get(w)??[];transactions.delete(w);return routes;}
