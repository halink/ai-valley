import type {Season} from './types.js';
export type FishHabitat='lake'|'river'|'coast';export const fishNames={perch:'湖鲈',carp:'河鲤',catfish:'夜鲶',bream:'雨鲂',snapper:'海鲷',cod:'寒水鳕',crucian:'冬鲫'};
export interface FishWindow {seasons:Season[];habitats:FishHabitat[];rain?:boolean;from:number;to:number;species:keyof typeof fishNames;}
const all:Season[]=['spring','summer','autumn','winter'],warm:Season[]=['spring','summer','autumn'];
export const fishingDefaults={capacity:12,renewalDays:10,rates:{lake:{spring:1,summer:.9,autumn:1.1,winter:.5},river:{spring:1.1,summer:1,autumn:.9,winter:.45},coast:{spring:.8,summer:1.2,autumn:1,winter:.7}},rainRiver:1.25,rainOther:1.05,dryMinutes:50,rainMinutes:42,winterExtra:10,minimumMinutes:25,skillMaximum:15,skillRate:2,toolRate:4,windows:[
 {seasons:['winter'],habitats:['coast'],from:6,to:17,species:'cod'},
 {seasons:['winter'],habitats:['lake','river'],from:6,to:17,species:'crucian'},
 {seasons:['summer','autumn'],habitats:['coast'],from:5,to:21,species:'snapper'},
 {seasons:warm,habitats:['coast'],rain:true,from:6,to:19,species:'bream'},
 {seasons:['spring'],habitats:['coast'],from:6,to:19,species:'perch'},
 {seasons:warm,habitats:['lake','river'],rain:true,from:4,to:23,species:'bream'},
 {seasons:['summer'],habitats:['lake','river'],from:19,to:2,species:'catfish'},
 {seasons:warm,habitats:['lake'],from:6,to:19,species:'perch'},
 {seasons:warm,habitats:['river'],from:6,to:19,species:'carp'},
 ] as FishWindow[]};
export function validFishingRules(v:Record<string,unknown>){const r={...fishingDefaults,...v};return ['capacity','renewalDays','rainRiver','rainOther','dryMinutes','rainMinutes','winterExtra','minimumMinutes','skillMaximum','skillRate','toolRate'].every(k=>typeof r[k as keyof typeof r]==='number'&&Number.isFinite(r[k as keyof typeof r])&&Number(r[k as keyof typeof r])>=0&&Number(r[k as keyof typeof r])<=10080)&&Number.isSafeInteger(r.capacity)&&r.capacity>0&&r.renewalDays>0&&r.minimumMinutes>0&&['lake','river','coast'].every(h=>all.every(s=>{const n=(r.rates as Record<string,Record<string,number>>)?.[h]?.[s];return typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=10;}))&&Array.isArray(r.windows)&&r.windows.length>0&&r.windows.length<=100&&r.windows.every(f=>f&&Array.isArray(f.seasons)&&f.seasons.length>0&&f.seasons.every(s=>all.includes(s))&&Array.isArray(f.habitats)&&f.habitats.length>0&&f.habitats.every(h=>['lake','river','coast'].includes(h))&&(f.rain===undefined||typeof f.rain==='boolean')&&Number.isInteger(f.from)&&Number.isInteger(f.to)&&f.from>=0&&f.from<24&&f.to>=0&&f.to<=24&&f.from!==f.to&&Object.hasOwn(fishNames,f.species));}
