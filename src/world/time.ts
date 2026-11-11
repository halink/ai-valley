import type {Season} from '../shared/types.js';
export const DAY=1440;
export const YEAR=112*DAY;
export const FORMAL_DAY_MINUTES=20;
export const FAST_DAY_MINUTES=30;
export const daylightLabels={dawn:'清晨',day:'白天',dusk:'黄昏',night:'夜晚'} as const;
export const seasons:Season[]=['spring','summer','autumn','winter'];
export function calendar(minute:number){const day=Math.floor(minute/DAY);return {year:Math.floor(day/112)+1,season:seasons[Math.floor(day/28)%4],day:day%28+1,hour:Math.floor(minute%DAY/60),minute:Math.floor(minute%60)};}
/**
 * Whole-year boundaries use the stored birth timestamp plus whole years, not
 * rounded subtraction/division. No time tolerance: even the previous float is
 * still before the birthday. Ordinary fractional ages stay continuous.
 * Invalid or unresolvable timestamps yield null. Unknown age is neither an
 * infant exemption nor adult permission, and never repairs the stored date.
 */
export function knownAgeYears(bornAt:unknown,minute:unknown):number|null {
 if(typeof bornAt!=='number'||typeof minute!=='number')return null;
 const elapsed=minute-bornAt;
 if(!Number.isFinite(bornAt)||!Number.isFinite(minute)||Math.abs(bornAt)>Number.MAX_SAFE_INTEGER
  ||Math.abs(minute)>Number.MAX_SAFE_INTEGER||!Number.isFinite(elapsed)||elapsed<0||elapsed>Number.MAX_SAFE_INTEGER)return null;
 const age=elapsed/YEAR,nearest=Math.round(age);
 if(nearest===0)return age;
 // Within this timestamp domain, arithmetic error is far below half a year.
 // Checking the nearest birthday handles large clocks too, without a growing
 // epsilon window that might authorize an action before its birthday.
 const birthday=bornAt+nearest*YEAR;
 if(minute>=birthday)return age<nearest?nearest:age;
 // Subtraction can also round UP to a birthday (notably for negative seed
 // dates). Keep the result below it by at most two ULPs of the integer age.
 return age>=nearest?nearest-Number.EPSILON*nearest:age;
}
/** Compatibility for continuous-age consumers and adult rejection gates only.
 * Zero on unknown dates MUST NOT prove a minor/infant authorization exemption. */
export function ageYears(bornAt:number,minute:number):number{return knownAgeYears(bornAt,minute)??0;}
export function gameMinutesFromWall(milliseconds:number,dayMinutes:number){return milliseconds*DAY/(dayMinutes*60_000);}
export function daylight(minute:number){
 const hour=minute%DAY/60;
 if(hour<5||hour>=21)return {phase:'night',darkness:.39} as const;
 if(hour<8)return {phase:'dawn',darkness:.39*(8-hour)/3} as const;
 if(hour<18)return {phase:'day',darkness:0} as const;
 return {phase:'dusk',darkness:.39*(hour-18)/3} as const;
}
