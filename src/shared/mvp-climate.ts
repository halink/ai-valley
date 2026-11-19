/** Isolated environmental preview, not an adopted simulation or crop input.
 * All numeric weather values use integer units; time remains a decimal string. */
export interface MvpClimateSnapshot {
 schemaVersion:1;
 algorithmVersion:1;
 parameterFingerprint:string;
 rhTableFingerprint:string;
 previewOnly:true;
 atUs:string;
 temperatureDeciC:number;
 relativeHumidityPermille:number;
 cloudPermille:number;
 windPermille:number;
 daylightPermille:number;
 precipitationPermille:number;
 condition:'sun'|'cloud'|'rain'|'snow'|'mixed';
}

/** Persisted point observation; deliberately not a numerical integrator. */
export type MvpClimatePoint=Omit<MvpClimateSnapshot,'previewOnly'|'schemaVersion'>&({schemaVersion:1;observationOnly:true}|{schemaVersion:2;soilWater:true}|{schemaVersion:3;agriculture:true});
export interface MvpClimateState {
 schemaVersion:1|2|3; capability:'observation-only'|'soil-water-v1'|'agriculture-v1'; seed:number; algorithmVersion:1;
 parameterFingerprint:string; rhTableFingerprint:string;
 adoptedMinute:number; adoptedUs:string; lastMinute:number; lastUs:string;
 current:MvpClimatePoint;
 rainProvenance?:MvpRainProvenance;
 spiritEffects?:import('./valley-spirit-effects.js').MvpSpiritEffects;
 spiritFruitSettlement?:import('./valley-spirit-fairness.js').MvpFallenFruitSettlementLedger;
}

/** A completed, fully observed precipitation episode containing pure rain. */
export interface MvpRainEpisode {
 rainEventId:string;
 startedUs:string;
 firstRainUs:string;
 endedUs:string;
}
export interface MvpRainProvenance {
 version:1;
 adoptedUs:string;
 recent:MvpRainEpisode[];
}
