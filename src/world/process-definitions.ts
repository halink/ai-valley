import {healthDefaults,careDefaults,cultureDefaults} from '../shared/process-definitions.js';
import type {World} from '../shared/types.js';
export type {HealthRules,CareRules} from '../shared/process-definitions.js';
const cache=new WeakMap<object,object>();
function freeze(v:object){for(const x of Object.values(v))if(x&&typeof x==='object'&&!Object.isFrozen(x))freeze(x);return Object.freeze(v);}
export function processDefinition<T extends object>(w:World,id:string,defaults:T,kind:'action'|'life'='action',binding?:string){const initial=id+'@1';w.definitions[initial]??={id,version:1,kind,dependencies:[],data:structuredClone(defaults) as Record<string,unknown>};const definition=binding??w.activeDefinitions[id]??initial,d=w.definitions[definition];if(!d||d.id!==id||d.kind!==kind)throw new Error('invalid_process_definition:'+id);let rules=cache.get(d) as T|undefined;if(!rules){rules=freeze({...structuredClone(defaults),...structuredClone(d.data)}) as T;cache.set(d,rules);}return {definition,rules};}
export const healthDefinition=(w:World,binding?:string)=>processDefinition(w,'health/rules',healthDefaults,'life',binding);
export const careDefinition=(w:World,binding?:string)=>processDefinition(w,'care/long',careDefaults,'action',binding);

export const cultureDefinition=(w:World,binding?:string)=>processDefinition(w,'culture/event',cultureDefaults,'action',binding);
