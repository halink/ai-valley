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
export type MvpClimatePoint=Omit<MvpClimateSnapshot,'previewOnly'|'schemaVersion'>&({schemaVersion:1;observationOnly:true}|{schemaVersion:2;soilWater:true});
export interface MvpClimateState {
 schemaVersion:1|2; capability:'observation-only'|'soil-water-v1'; seed:number; algorithmVersion:1;
 parameterFingerprint:string; rhTableFingerprint:string;
 adoptedMinute:number; adoptedUs:string; lastMinute:number; lastUs:string;
 current:MvpClimatePoint;
}
