/** A momentary field observation, not a growth forecast or permission to act. */
export interface CropObservation {
 atMinute:number;
 stage:'empty'|'growing'|'mature'|'unknown';
 wateredToday:boolean|null;
 inSeason:boolean|null;
 rainingNow:boolean;
}
