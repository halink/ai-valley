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
