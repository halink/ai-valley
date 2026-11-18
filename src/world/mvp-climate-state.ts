import type {World} from '../shared/types.js';
import type {MvpClimatePoint} from '../shared/mvp-climate.js';
import {climateAt,minuteToClimateUs,parseClimateUs,MVP_CLIMATE_PARAMETER_FINGERPRINT} from './mvp-climate.js';
import {MVP_CLIMATE_RH_FINGERPRINT} from './mvp-climate-rh.js';
import {isSupportedMvpMap} from '../shared/mvp-hamlet.js';
const owns=(v:object,k:string)=>Object.prototype.hasOwnProperty.call(v,k);
function point(seed:number,minute:number):MvpClimatePoint {const {previewOnly,...sample}=climateAt(seed,minute);return {...sample,observationOnly:true};}
function same(a:unknown,b:unknown):boolean {
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)||Array.isArray(b))return false;
 const x=a as Record<string,unknown>,y=b as Record<string,unknown>;
 return Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>owns(y,k)&&same(x[k],y[k]));
}
export function assertMvpClimateWorld(w:World):void {
 if(w.mode!=='validation'||!w.id.startsWith('godot-mvp-')||w.scenario!==undefined||!isSupportedMvpMap(w.map))throw Error('mvp_climate_world_scope');
}
/** Presence is not absence: malformed/future data must never be re-adopted. */
export function validateMvpClimate(w:World):void {
 if(!owns(w,'mvpClimate'))return;
 assertMvpClimateWorld(w);
 const s=w.mvpClimate;
 if(!s||typeof s!=='object'||Array.isArray(s)||s.schemaVersion!==1||s.capability!=='observation-only'||s.algorithmVersion!==1||s.seed!==w.seed||s.parameterFingerprint!==MVP_CLIMATE_PARAMETER_FINGERPRINT||s.rhTableFingerprint!==MVP_CLIMATE_RH_FINGERPRINT)throw Error('mvp_climate_unsupported_state');
 const keys=['schemaVersion','capability','seed','algorithmVersion','parameterFingerprint','rhTableFingerprint','adoptedMinute','adoptedUs','lastMinute','lastUs','current'];
 if(Object.keys(s).length!==keys.length||keys.some(k=>!owns(s,k)))throw Error('mvp_climate_unknown_fields');
 if(minuteToClimateUs(s.adoptedMinute)!==s.adoptedUs||minuteToClimateUs(s.lastMinute)!==s.lastUs||s.lastMinute!==w.minute||s.adoptedMinute>s.lastMinute||parseClimateUs(s.adoptedUs)>parseClimateUs(s.lastUs))throw Error('mvp_climate_clock_mismatch');
 if(!same(s.current,point(w.seed,w.minute)))throw Error('mvp_climate_sample_mismatch');
}
export function adoptMvpClimate(w:World):boolean {
 if(owns(w,'simulationOnly'))throw Error('mvp_climate_simulation_adoption');
 if(owns(w,'mvpClimate')){validateMvpClimate(w);return false;}
 assertMvpClimateWorld(w);
 const current=point(w.seed,w.minute);
 w.mvpClimate={schemaVersion:1,capability:'observation-only',seed:w.seed,algorithmVersion:1,parameterFingerprint:MVP_CLIMATE_PARAMETER_FINGERPRINT,rhTableFingerprint:MVP_CLIMATE_RH_FINGERPRINT,adoptedMinute:w.minute,adoptedUs:current.atUs,lastMinute:w.minute,lastUs:current.atUs,current};return true;
}
/** Called on a genuine live draft. Endpoint only: no soil integration/events. */
export function advanceMvpClimate(w:World,previousMinute:number):void {
 if(!owns(w,'mvpClimate'))return;
 const s=w.mvpClimate!;
 validateMvpClimate({...w,minute:previousMinute});
 if(w.minute<previousMinute)throw Error('mvp_climate_clock_reversal');
 const current=point(w.seed,w.minute);
 if(parseClimateUs(current.atUs)<parseClimateUs(s.lastUs))throw Error('mvp_climate_clock_reversal');
 w.mvpClimate={...s,lastMinute:w.minute,lastUs:current.atUs,current};
}
export function rejectMvpClimateForModels(w:unknown):void {
 if(w&&typeof w==='object'&&owns(w,'mvpClimate'))throw Error('mvp_climate_model_entry_unsupported');
}
