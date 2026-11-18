import type {MvpClimateSnapshot} from '../shared/mvp-climate.js';
import {MVP_CLIMATE_RH_FACTORS,MVP_CLIMATE_RH_FINGERPRINT} from './mvp-climate-rh.js';

/** Version 1 is preview-only. It neither advances nor migrates a World. Changing
 * this algorithm or its constants requires a new version, not a save rewrite. */
export const MVP_CLIMATE_MAX_MINUTE=10_000_000_000;
export const MVP_CLIMATE_MAX_US='10000000000000000';
export const MVP_CLIMATE_PARAMETERS='mvp-climate-preview-v1:us1e6;max1e10m;slot60;year112d;midpoints14,42,70,98;temp140,250,150,30;daily+-40@05,17;noise+-40;rain350/1000,start60+mod1000,duration90+mod241,ramp20,peak400+mod601;wet-ramp-to-saturation;raincloud950;cloud-threshold600;phase0,20deciC;dew30+mod91;cloud150+mod751;wind100+mod701;sun05,12,19,cloud0.7;rh1e9';
// SHA-256 of the exact UTF-8 parameter string above, frozen with algorithm v1.
export const MVP_CLIMATE_PARAMETER_FINGERPRINT='a887831a6ddc7923bbd18179e24bffdddb7b83817620bd278aacbb83dd3e8f0a';
const US=1_000_000n,DAY=1440n*US,SLOT=60n*US,YEAR=112n*DAY;

/** Parse the engine Number's canonical decimal representation, not a floating
 * multiply. Scientific notation from Number.toString is expanded by exponents.
 * Rounding is nearest micro-minute, positive ties upward. The original engine
 * clock remains untouched; callers must not accumulate a second clock here. */
export function minuteToClimateUs(minute:number):string {
 if(!Number.isFinite(minute)||minute<0||Object.is(minute,-0)||minute>MVP_CLIMATE_MAX_MINUTE)
  throw new Error('mvp_climate_invalid_minute');
 const match=/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(minute));
 if(!match)throw new Error('mvp_climate_invalid_minute');
 const fraction=match[2]??'',power=6+Number(match[3]??0)-fraction.length;
 const digits=BigInt(match[1]+fraction);
 const value=power>=0?digits*10n**BigInt(power):roundRatio(digits,10n**BigInt(-power));
 if(value>BigInt(MVP_CLIMATE_MAX_US))throw new Error('mvp_climate_time_overflow');
 return value.toString();
}

/** Stored micro-minutes are canonical unsigned decimal strings only. */
export function parseClimateUs(value:unknown):bigint {
 if(typeof value!=='string'||value.length>17||!/^(0|[1-9]\d*)$/.test(value))
  throw new Error('mvp_climate_invalid_time');
 const us=BigInt(value);
 if(us>BigInt(MVP_CLIMATE_MAX_US))throw new Error('mvp_climate_time_overflow');
 return us;
}
function roundRatio(n:bigint,d:bigint):bigint {
 // floor(x+0.5), including negative temperatures. Avoid JS truncation at zero.
 const shifted=2n*n+d,denominator=2n*d;
 return shifted>=0n?shifted/denominator:-((-shifted+denominator-1n)/denominator);
}
function lerp(a:number,b:number,t:bigint,length:bigint):number {
 return Number(roundRatio(BigInt(a)*length+BigInt(b-a)*t,length));
}
function hash(seed:number,index:number,channel:number):number {
 let x=(seed^Math.imul(index,0x9e3779b1)^Math.imul(channel,0x85ebca6b))>>>0;
 x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);
 return (x^(x>>>16))>>>0;
}
function slotValue(seed:number,us:bigint,channel:number,min:number,span:number):number {
 const slot=Number(us/SLOT),offset=us%SLOT;
 return lerp(min+hash(seed,slot,channel)%span,min+hash(seed,slot+1,channel)%span,offset,SLOT);
}
function seasonalTemperature(us:bigint):number {
 // Shift year origin to previous winter midpoint. No season-boundary jumps.
 const phase=(us+14n*DAY)%YEAR,segment=Number(phase/(28n*DAY)),offset=phase%(28n*DAY);
 const midpoints=[30,140,250,150,30];
 return lerp(midpoints[segment],midpoints[segment+1],offset,28n*DAY);
}
function dailyTemperature(us:bigint):number {
 const phase=(us+19n*60n*US)%DAY;
 return phase<DAY/2n?lerp(-40,40,phase,DAY/2n):lerp(40,-40,phase-DAY/2n,DAY/2n);
}
function precipitation(seed:number,us:bigint):{intensity:number;saturation:number} {
 const day=Number(us/DAY),within=us%DAY;
 if(hash(seed,day,4)%1000>=350)return {intensity:0,saturation:0};
 const start=BigInt(60+hash(seed,day,5)%1000)*US;
 const end=start+BigInt(90+hash(seed,day,6)%241)*US;
 if(within<start||within>=end)return {intensity:0,saturation:0};
 const ramp=20n*US,distance=within-start<end-within?within-start:end-within;
 const peak=400+hash(seed,day,7)%601;
 return {intensity:distance<ramp?lerp(0,peak,distance,ramp):peak,
  saturation:distance<ramp?lerp(0,1000,distance,ramp):1000};
}
/** RH rounded to 0.1 percentage point from the same quantized T and Td.
 * BigInt ratio prevents large multiplication from losing integer precision. */
export function climateRelativeHumidity(temperatureDeciC:number,dewpointDeciC:number):number {
 if(!Number.isInteger(temperatureDeciC)||!Number.isInteger(dewpointDeciC)
  ||dewpointDeciC< -300||temperatureDeciC>450||dewpointDeciC>temperatureDeciC)
  throw new Error('mvp_climate_invalid_thermodynamics');
 const dry=MVP_CLIMATE_RH_FACTORS[temperatureDeciC+300],wet=MVP_CLIMATE_RH_FACTORS[dewpointDeciC+300];
 return Number(roundRatio(BigInt(wet)*1000n,BigInt(dry)));
}
function daylight(us:bigint,cloud:number):number {
 const within=us%DAY,morning=300n*US,noon=720n*US,evening=1140n*US;
 const clear=within<morning||within>=evening?0:within<=noon
  ?lerp(0,1000,within-morning,noon-morning):lerp(1000,0,within-noon,evening-noon);
 return Number(roundRatio(BigInt(clear)*BigInt(10000-7*cloud),10000n));
}

/** Pure snapshot at the existing world's committed endpoint. No World writes,
 * personal knowledge, persistent rain receipts, soil or production effects. */
export function climateAt(seed:number,minute:number):MvpClimateSnapshot {
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('mvp_climate_invalid_seed');
 const atUs=minuteToClimateUs(minute),us=parseClimateUs(atUs);
 const temperatureDeciC=seasonalTemperature(us)+dailyTemperature(us)+slotValue(seed,us,1,-40,81);
 const rain=precipitation(seed,us),precipitationPermille=rain.intensity;
 const cloudPermille=Math.max(slotValue(seed,us,2,150,751),lerp(0,950,BigInt(rain.saturation),1000n));
 const windPermille=slotValue(seed,us,3,100,701);
 const dryDepression=slotValue(seed,us,8,30,91);
 const depression=lerp(dryDepression,0,BigInt(rain.saturation),1000n);
 const relativeHumidityPermille=climateRelativeHumidity(temperatureDeciC,temperatureDeciC-depression);
 const condition:MvpClimateSnapshot['condition']=precipitationPermille>0
  ?temperatureDeciC<=0?'snow':temperatureDeciC>=20?'rain':'mixed'
  :cloudPermille>=600?'cloud':'sun';
 return {schemaVersion:1,algorithmVersion:1,parameterFingerprint:MVP_CLIMATE_PARAMETER_FINGERPRINT,
  rhTableFingerprint:MVP_CLIMATE_RH_FINGERPRINT,previewOnly:true,atUs,temperatureDeciC,
  relativeHumidityPermille,cloudPermille,windPermille,daylightPermille:daylight(us,cloudPermille),
  precipitationPermille,condition};
}
