import type {CropObservation} from '../shared/crop-observation.js';
import type {Plot,Resident,World} from '../shared/types.js';
import {canObserveOutdoors,validPoint,clearSight} from './outdoor-observation.js';
import {distance} from './navigation.js';
import {calendar,DAY} from './time.js';

/** Title supplies an address, never remote live crop knowledge. Ground travel
 * does not erase actual presence, but an old shore coordinate is not a boat view. */
export function visibleOwnPlots(w:World,r:Resident):Plot[]{
 if(!canObserveOutdoors(w,r))return [];
 return w.plots.filter(p=>p.ownerId===r.id&&validPoint(w,p.at)&&distance(r.at,p.at)<=8&&clearSight(w,r.at,p.at))
  .sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at)||a.id.localeCompare(b.id));
}
export function cropObservation(w:World,p:Plot):CropObservation {
 const observation:CropObservation={atMinute:w.minute,stage:'empty',wateredToday:null,inSeason:null,rainingNow:w.weather==='rain'};
 if(!p.crop)return observation;
 const d=w.definitions[p.crop.definition],days=Number(d?.data.growthDays),seasons=d?.data.seasons;
 observation.stage=Number.isFinite(days)&&days>0&&Number.isFinite(p.crop.growth)?p.crop.growth>=days?'mature':'growing':'unknown';
 observation.wateredToday=p.crop.wateredDay===Math.floor(w.minute/DAY);
 observation.inSeason=Array.isArray(seasons)?seasons.includes(calendar(w.minute).season):null;
 return observation;
}
