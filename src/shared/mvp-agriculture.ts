import type {Season} from './types.js';
export type Cultivar='spring'|'summer'|'winter';
export const CULTIVARS={
 spring:{name:'春秋芜菁',seed:'springSeed',root:'springRoot',days:4,seasons:['spring','autumn'],low:0,idealLow:80,idealHigh:220,high:300},
 summer:{name:'夏根',seed:'summerSeed',root:'summerRoot',days:4,seasons:['summer'],low:80,idealLow:180,idealHigh:300,high:380},
 winter:{name:'冬根',seed:'winterSeed',root:'winterRoot',days:6,seasons:['winter'],low:-80,idealLow:0,idealHigh:100,high:200},
} as const;
export const cultivarKeys=Object.keys(CULTIVARS) as Cultivar[];
export function temperatureFactor(c:Cultivar,t:number):number {const d=CULTIVARS[c];if(t<=d.low||t>=d.high)return 0;if(t>=d.idealLow&&t<=d.idealHigh)return 400;return t<d.idealLow?(t-d.low)*400/(d.idealLow-d.low):(d.high-t)*400/(d.high-d.idealHigh);}
export interface PlantTarget {plotId:string;epoch:string;instanceId:string|null;replace:boolean;}
export type AgricultureAction={type:'mvpAgriculture';operation:'plant'|'harvest'|'clear';target:PlantTarget;cultivar:Cultivar}|{type:'mvpAgriculture';operation:'collectSeed';cultivar:Cultivar;target:PlantTarget;targets:PlantTarget[]}|{type:'mvpAgriculture';operation:'saveSeed'|'cook';cultivar:Cultivar};
export interface CropInstance {id:string;kind:'legacy'|'climate';cultivar:Cultivar|null;definition:string;planted:number;growthNumerator:string|null;maturedUs:string|null;}
export interface AgriculturePlot {plotId:string;epoch:string;instance:CropInstance|null;}
export interface MvpAgriculture {schemaVersion:1;parameterFingerprint:string;adoptedMinute:number;adoptedUs:string;nextSequence:string;plots:AgriculturePlot[];grants:Record<Cultivar,{grantId:string;initial:number;stock:number;plotCount:number;residentCount:number;firstWindowSeason:Season;firstWindowDay:number}>;claims:Record<string,{actorId:string;plotId:string;epoch:string;cultivar:Cultivar;executionId:string;eventId:string}>;receipts:Record<string,{actorId:string;operation:string;cultivar:Cultivar;plotId:string|null;eventId:string}>;}
export interface AgricultureObservation {schemaVersion:1;atUs:string;plots:Array<{plotId:string;kind:'empty'|'legacy'|'climate';instanceId:string|null;epoch:string;cultivar:Cultivar|null;name:string|null;growthDays:number;targetDays:number;progressPermille:number;mature:boolean;temperatureFactorPermille:number;waterFactorPermille:number;limitedBy:'empty'|'legacy'|'mature'|'temperature'|'water'|'temperature-and-water'|'none'}>;seedStock:Array<{cultivar:Cultivar;name:string;initial:number;stock:number;canSow:boolean}>;}
