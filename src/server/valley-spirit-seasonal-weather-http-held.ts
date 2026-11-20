/** A provider-shaped protocol rehearsal only. No endpoint, fetch, credential,
 * or caller-supplied callback exists in this module. */
import {createHash} from 'node:crypto';
import {PRODUCTION_MODEL_CANDIDATE as candidate} from './production-model-policy.js';
import {seasonalWeatherWireRequest,groundSeasonalWeatherWireReply,
 type SeasonalWirePoint} from './valley-spirit-seasonal-weather-wire.js';

export const SEASONAL_HELD_WEATHER_OUTPUT_TOKENS=512;
const envelopeBytes=4096;
const system='Select exactly one claim from the supplied weather point. Return only the canonical seasonal-weather-claims/v1 JSON claim with its ref, field and unchanged value.';
const digest=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const count=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const kinds=['sun','cloud','rain','snow','mixed'] as const;
export function prepareSeasonalHeldWeatherBody(point:SeasonalWirePoint){
 if(!count(point.observedMinute,0,10_000_000)||!kinds.includes(point.condition)||
  !count(point.temperatureDeciC,-300,450)||!count(point.relativeHumidityPermille,0,1000))return null;
 const wire=seasonalWeatherWireRequest(point);
 const body=JSON.stringify({model:candidate.model,messages:[{role:'system',content:system},{role:'user',content:wire.bytes}],
  temperature:0,stream:false,max_tokens:SEASONAL_HELD_WEATHER_OUTPUT_TOKENS,enable_thinking:false});
 return Object.freeze({wire,body,bodyDigest:digest(body),inputTokenBound:Buffer.byteLength(body,'utf8')+512});
}
/** A valid bounded synthetic completion envelope can spend quota but may
 * still fail to ground a claim. Unknown envelopes are never settled. */
export function parseSeasonalHeldWeatherCompletion(point:SeasonalWirePoint,raw:unknown){
 const prepared=prepareSeasonalHeldWeatherBody(point);
 if(!prepared||typeof raw!=='string'||raw.length>envelopeBytes||Buffer.byteLength(raw)>envelopeBytes)return null;
 try{
  const x:unknown=JSON.parse(raw);
  if(!exact(x,['model','choices','usage'])||x.model!==candidate.model||!Array.isArray(x.choices)||x.choices.length!==1||
   !exact(x.usage,['prompt_tokens','completion_tokens','total_tokens']))return null;
  const choice=x.choices[0],{prompt_tokens:inputTokens,completion_tokens:outputTokens,total_tokens:totalTokens}=x.usage;
  if(!count(inputTokens,1,prepared.inputTokenBound)||!count(outputTokens,0,SEASONAL_HELD_WEATHER_OUTPUT_TOKENS)||
   totalTokens!==inputTokens+outputTokens)return null;
  if(!exact(choice,['index','message','finish_reason'])||choice.index!==0||
   (choice.finish_reason!=='stop'&&choice.finish_reason!=='length')||!exact(choice.message,['role','content'])||
   choice.message.role!=='assistant'||typeof choice.message.content!=='string'||
   (choice.message.content.length>0&&outputTokens===0))return null;
  // Synthetic shape is byte-canonical. Reject duplicate/hidden keys that
  // JSON.parse alone would lose; this is not a provider compatibility claim.
  if(raw!==JSON.stringify({model:candidate.model,choices:[{index:0,message:{role:'assistant',content:choice.message.content},
   finish_reason:choice.finish_reason}],usage:{prompt_tokens:inputTokens,completion_tokens:outputTokens,total_tokens:totalTokens}}))
   return null;
  return Object.freeze({inputTokens,outputTokens,
   fact:choice.finish_reason==='stop'?groundSeasonalWeatherWireReply(point,choice.message.content):null});
 }catch{return null;}
}
export type SeasonalHeldWeatherTransport=Readonly<{kind:'seasonal-weather-claims-http-held-memory'}>;
type Call={body:string;reply:(raw:unknown)=>void;disconnect:()=>void};
const memory=new WeakMap<SeasonalHeldWeatherTransport,{claimed:boolean;invoke:(body:string,signal:AbortSignal)=>Promise<unknown>}>();
export function createSeasonalHeldWeatherMemory(){
 const transport=Object.freeze({kind:'seasonal-weather-claims-http-held-memory'} as const),calls:Call[]=[];
 memory.set(transport,{claimed:false,invoke:(body,signal)=>new Promise((resolve,reject)=>{
  const cancel=()=>reject(Error('seasonal_weather_http_held_unknown'));
  if(signal.aborted){cancel();return;}
  signal.addEventListener('abort',cancel,{once:true});
  calls.push({body,reply:raw=>{signal.removeEventListener('abort',cancel);resolve(typeof raw==='string'?raw:null);},
   disconnect:()=>{signal.removeEventListener('abort',cancel);cancel();}});
 })});
 return {transport,requests:()=>calls.map(c=>c.body),reply:(i:number,v:unknown)=>calls[i].reply(v),disconnect:(i:number)=>calls[i].disconnect()};
}
export function claimSeasonalHeldWeatherMemory(transport:SeasonalHeldWeatherTransport){
 const item=memory.get(transport);
 if(!item||item.claimed)throw Error('seasonal_weather_http_held_transport_untrusted');
 item.claimed=true;
 return item.invoke;
}
