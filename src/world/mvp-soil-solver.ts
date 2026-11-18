import type {SoilAmounts,SoilRates} from '../shared/mvp-soil.js';
export const SOIL_DENOMINATOR=1440000000000000n;
export const SOIL_GRID_US=50000n;
const CAP=100n*SOIL_DENOMINATOR;
export const SOIL_KEYS=['water','snow','initial','rainIn','snowIn','melt','irrigation','evaporation','drainage'] as const;
const min=(a:bigint,b:bigint)=>a<b?a:b;
/** Exact closed-form of the frozen micro-minute recurrence, not coarse Euler:
 * snow+=N; melt=min(M,snow); soil+=R+melt; E=min(E,soil); drain=max(soil-E-C,0).
 * Snow has at most: full-melt prefix, one depletion microstep, supply-limited tail.
 * In each phase soil is a monotone saturated linear recurrence. Algebra below
 * counts actual evaporation/drain at the earliest discrete threshold, preserving
 * all fractional numerators. Call boundaries have no numerical significance. */
export function soilPrefix(start:SoilAmounts,rates:SoilRates,duration:bigint):SoilAmounts {
 if(duration<0n)throw Error('soil_negative_duration');
 const a=Object.fromEntries(SOIL_KEYS.map(k=>[k,BigInt(start[k])])) as Record<typeof SOIL_KEYS[number],bigint>;
 const r=BigInt(rates.rain),n=BigInt(rates.snow),m=BigInt(rates.melt),e=BigInt(rates.evaporation);
 if([r,n,m,e,...Object.values(a)].some(x=>x<0n)||a.water>CAP)throw Error('soil_invalid_solver_input');
 const phase=(ticks:bigint,melt:bigint)=>{
  if(ticks===0n)return;
  const input=r+melt,delta=input-e,old=a.water;
  // For delta>=0 every microstep can evaporate e. For delta<0, once
  // depleted only incoming water evaporates. These are exact recurrence sums.
  if(delta>=0n){const unbounded=old+delta*ticks;a.water=min(CAP,unbounded);a.evaporation+=e*ticks;a.drainage+=unbounded-a.water;}
  else{const unbounded=old+delta*ticks;a.water=unbounded>0n?unbounded:0n;a.evaporation+=old+input*ticks-a.water;}
  a.snow+=(n-melt)*ticks;a.snowIn+=n*ticks;a.rainIn+=r*ticks;a.melt+=melt*ticks;
 };
 if(n>=m)phase(duration,m);
 else{
  const full=min(duration,a.snow/(m-n));phase(full,m);let left=duration-full;
  if(left>0n){phase(1n,a.snow+n);left--;}
  phase(left,n);
 }
 return Object.fromEntries(SOIL_KEYS.map(k=>[k,a[k].toString()])) as unknown as SoilAmounts;
}
