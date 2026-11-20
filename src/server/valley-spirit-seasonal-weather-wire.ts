import {createHash} from 'node:crypto';
import type {nativeSeasonalWeatherPairMenu} from './valley-spirit-topics.js';

const PROFILE='seasonal-weather-claims/v1';
const reference='point-1';
export const SEASONAL_WEATHER_WIRE_REPLY_BYTES=512;
const fields=['condition','temperatureDeciC','relativeHumidityPermille'] as const;
type Field=(typeof fields)[number];
const names={sun:'晴',cloud:'阴',rain:'雨',snow:'雪',mixed:'雨雪混合'} as const;
export type SeasonalWirePoint=Readonly<{observedMinute:number;condition:keyof typeof names;temperatureDeciC:number;relativeHumidityPermille:number}>;
const allowed=(x:unknown):x is Field=>fields.some(f=>f===x);
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function seasonalWeatherWireRequest(point:SeasonalWirePoint){
 const bytes=JSON.stringify({schema:PROFILE,point:{ref:reference,observedMinute:point.observedMinute,condition:point.condition,
  temperatureDeciC:point.temperatureDeciC,relativeHumidityPermille:point.relativeHumidityPermille}});
 return Object.freeze({bytes,digest:createHash('sha256').update(bytes,'utf8').digest('hex')});
}
function renderSeasonalWeatherWireClaim(point:SeasonalWirePoint,field:Field){
 const text=field==='condition'?('天气：'+names[point.condition]):field==='temperatureDeciC'?
  ('气温：'+(point.temperatureDeciC/10).toFixed(1)+'℃'):('相对湿度：'+(point.relativeHumidityPermille/10).toFixed(1)+'%');
 return Object.freeze({observedMinute:point.observedMinute,field,value:point[field],text:`第 ${point.observedMinute} 游戏分钟，${text}`});
}
/** A measured string may be invalid but is a known completion. The wire
 * schema intentionally does not admit editorial tone or rendered words. */
export function groundSeasonalWeatherWireReply(point:SeasonalWirePoint,bytes:unknown){
 if(typeof bytes!=='string'||bytes.length>SEASONAL_WEATHER_WIRE_REPLY_BYTES||Buffer.byteLength(bytes)>SEASONAL_WEATHER_WIRE_REPLY_BYTES)return null;
 try{
  const payload:unknown=JSON.parse(bytes);
  if(!object(payload)||payload.schema!==PROFILE||!Array.isArray(payload.claims)||payload.claims.length!==1)return null;
  const [claim]=payload.claims;
  if(!object(claim)||claim.ref!==reference||!allowed(claim.field)||!Object.is(claim.value,point[claim.field]))return null;
  // A single canonical byte shape also excludes duplicate keys after JSON.parse.
  const canonical=JSON.stringify({schema:PROFILE,claims:[{ref:reference,field:claim.field,value:point[claim.field]}]});
  return bytes===canonical?renderSeasonalWeatherWireClaim(point,claim.field):null;
 }catch{return null;}
}
export function validSeasonalWeatherWireDraft(point:SeasonalWirePoint,v:unknown){
 return object(v)&&allowed(v.field)&&JSON.stringify(v)===JSON.stringify(renderSeasonalWeatherWireClaim(point,v.field));
}

export type SeasonalWeatherMemoryTransport=Readonly<{kind:'seasonal-weather-claims-memory'}>;
type Entry={bytes:string;reply:(v:unknown)=>void;disconnect:()=>void};
const transports=new WeakMap<SeasonalWeatherMemoryTransport,{claimed:boolean;invoke:(bytes:string,signal:AbortSignal)=>Promise<unknown>}>();
const TOPIC_PROFILE='seasonal-weather-topic-choice/v1';
type PairMenu=NonNullable<ReturnType<typeof nativeSeasonalWeatherPairMenu>>;
/** Correlation token commits to the exact anonymous menu content, not to
 * a world, account, real source ref, user, or equipment identity. */
export function seasonalWeatherTopicChoiceRequest(menu:PairMenu){
 const menuToken=createHash('sha256').update(JSON.stringify([TOPIC_PROFILE,menu]),'utf8').digest('hex');
 const bytes=JSON.stringify({schema:TOPIC_PROFILE,menuToken,menu});
 return Object.freeze({menuToken,bytes,digest:createHash('sha256').update(bytes,'utf8').digest('hex')});
}
export function groundSeasonalWeatherTopicChoice(menu:PairMenu,menuToken:string,bytes:unknown){
 if(typeof bytes!=='string'||bytes.length>SEASONAL_WEATHER_WIRE_REPLY_BYTES||Buffer.byteLength(bytes)>SEASONAL_WEATHER_WIRE_REPLY_BYTES)return null;
 try{
  const v:unknown=JSON.parse(bytes);
  if(!object(v)||v.schema!==TOPIC_PROFILE||v.menuToken!==menuToken||!Number.isSafeInteger(v.option)||
   !menu.options.some(o=>o.number===v.option))return null;
  return bytes===JSON.stringify({schema:TOPIC_PROFILE,menuToken,option:v.option})?Object.freeze({number:v.option as number}):null;
 }catch{return null;}
}
/** Fixture driver can only observe immutable request bytes and supply a string
 * result or disconnection. No configured URL, sender, resolver or network I/O. */
export function createSeasonalWeatherMemoryTransport(){
 const transport=Object.freeze({kind:'seasonal-weather-claims-memory'} as const),calls:Entry[]=[];
 transports.set(transport,{claimed:false,invoke:(bytes,signal)=>new Promise((resolve,reject)=>{
  const cancel=()=>reject(Error('seasonal_weather_wire_unknown'));
  if(signal.aborted){cancel();return;}
  signal.addEventListener('abort',cancel,{once:true});
  calls.push({bytes,reply:v=>{signal.removeEventListener('abort',cancel);resolve(typeof v==='string'?v:null);},
   disconnect:()=>{signal.removeEventListener('abort',cancel);cancel();}});
 })});
 return {transport,requests:()=>calls.map(c=>c.bytes),
  reply:(i:number,value:unknown)=>calls[i].reply(value),disconnect:(i:number)=>calls[i].disconnect()};
}
export function claimSeasonalWeatherMemoryTransport(transport:SeasonalWeatherMemoryTransport){
 const item=transports.get(transport);
 if(!item||item.claimed)throw Error('seasonal_weather_wire_transport_untrusted');
 item.claimed=true;
 return item.invoke;
}
