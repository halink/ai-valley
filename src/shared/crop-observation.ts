/** A momentary field observation, not a growth forecast or permission to act. */
export interface CropObservation {
 growthSystem?:'climate';
 atMinute:number;
 stage:'empty'|'growing'|'mature'|'unknown';
 wateredToday:boolean|null;
 inSeason:boolean|null;
 rainingNow:boolean;
 /** Present only for an adopted MVP climate: old crops still use legacy day rain. */
 legacyRainDay?:boolean;
}
