import {industryDefaults} from '../shared/industry-rules.js';import type {World} from '../shared/types.js';import {processDefinition} from './process-definitions.js';
export function industryDefinition(w:World,binding?:string){return processDefinition(w,'industry/processes',industryDefaults,'action',binding);}
/** Existing physical instances keep the rules under which they were registered. */
export function initializeIndustryRules(w:World){industryDefinition(w,'industry/processes@1');const s=w.industry;if(!s)return;for(const t of [...s.tools,...s.trees,...s.animals,...s.mines,...(s.livestockCargo??[])])t.definition??='industry/processes@1';}
