import type {Season} from '../shared/types.js';
export const DAY=1440;
export const YEAR=112*DAY;
export const FORMAL_DAY_MINUTES=20;
export const FAST_DAY_MINUTES=30;
export const daylightLabels={dawn:'清晨',day:'白天',dusk:'黄昏',night:'夜晚'} as const;
export const seasons:Season[]=['spring','summer','autumn','winter'];
export function calendar(minute:number){const day=Math.floor(minute/DAY);return {year:Math.floor(day/112)+1,season:seasons[Math.floor(day/28)%4],day:day%28+1,hour:Math.floor(minute%DAY/60),minute:Math.floor(minute%60)};}
export function ageYears(bornAt:number,minute:number){return (minute-bornAt)/YEAR;}
export function gameMinutesFromWall(milliseconds:number,dayMinutes:number){return milliseconds*DAY/(dayMinutes*60_000);}
export function daylight(minute:number){
 const hour=minute%DAY/60;
 if(hour<5||hour>=21)return {phase:'night',darkness:.39} as const;
 if(hour<8)return {phase:'dawn',darkness:.39*(8-hour)/3} as const;
 if(hour<18)return {phase:'day',darkness:0} as const;
 return {phase:'dusk',darkness:.39*(hour-18)/3} as const;
}
