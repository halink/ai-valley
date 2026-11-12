import {QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL} from './model-completion.js';
export type SelfHostedCooldown={observedAt:number;blockedUntil:number;limitCount:number};
export function cooldownDelay(count:number){return Math.min(900_000,30_000*2**(count-1));}
/** Persisted wall-clock deadlines survive normal restarts. Backward clocks and
 * malformed records fail closed; an external clock's accuracy is not certified. */
export function readSelfHostedCooldowns(value:unknown,now:number):Record<string,SelfHostedCooldown>{
 if(!Number.isSafeInteger(now)||now<0)throw Error('self_hosted_clock_invalid');
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('self_hosted_cooldown_invalid');
 const result:Record<string,SelfHostedCooldown>={};
 for(const [model,raw] of Object.entries(value)){
  const c=raw as SelfHostedCooldown;
  if(![QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL].includes(model)||!c||typeof c!=='object'
   ||Object.keys(c).sort().join(',')!=='blockedUntil,limitCount,observedAt'
   ||!Number.isSafeInteger(c.observedAt)||c.observedAt<0||!Number.isSafeInteger(c.blockedUntil)
   ||!Number.isSafeInteger(c.limitCount)||c.limitCount<1||c.limitCount>6
   ||c.blockedUntil!==c.observedAt+cooldownDelay(c.limitCount))throw Error('self_hosted_cooldown_invalid');
  if(now<c.observedAt)throw Error('self_hosted_clock_rollback');
  result[model]={...c};
 }
 return result;
}
