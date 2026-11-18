import type {Vec} from './types.js';
import type {Cultivar,PlantTarget} from './mvp-agriculture.js';
export type SeasonalInspectAction={type:'mvpInspect';station:'seed'|'kitchen'};
export interface SeenSeasonalPlot {at:Vec;target:PlantTarget;cultivar:Cultivar|null;kind:'empty'|'legacy'|'climate';mature:boolean;soil:'dry'|'adequate'|null;}
export interface SeasonalPlotReceipt {id:string;worldId:string;observerId:string;observedAt:number;observerAt:Vec;plot:SeenSeasonalPlot;}
export interface SeasonalKnowledge {schemaVersion:1;worldId:string;observerId:string;nextSequence:number;latest:Record<string,string>;receipts:Record<string,SeasonalPlotReceipt>;}
export interface SeasonalPersonalContext {
 schemaVersion:1;atMinute:number;
 weather:null|{condition:'sun'|'cloud'|'rain'|'snow'|'mixed';temperature:'cold'|'mild'|'warm';humidity:'dry'|'ordinary'|'humid'};
 plots:SeenSeasonalPlot[];
 rememberedPlots:SeasonalPlotReceipt[];
 hall:null|{id:string;door:Vec;seedStock:Record<Cultivar,number>|null;preserverInstalled:boolean|null};
 preservation:null|{unknownFreshness:number;lots:Array<{quantity:number;producedAt:number;expiresAt:number}>};
}
