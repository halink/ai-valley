import {physiologyDefaults} from '../shared/physiology.js';import type {Resident,World} from '../shared/types.js';import {processDefinition} from './process-definitions.js';
export const physiologyDefinition=(w:World,key?:string)=>processDefinition(w,'life/physiology',physiologyDefaults,'life',key);
export function initializePhysiology(w:World){physiologyDefinition(w,'life/physiology@1');for(const r of [...w.residents,...(w.migration?.contacts.flatMap(c=>c.person?[c.person]:[])??[])])r.physiologyDefinition??='life/physiology@1';}
export const physiology=(w:World,r:Resident)=>physiologyDefinition(w,r.physiologyDefinition??'life/physiology@1').rules;
