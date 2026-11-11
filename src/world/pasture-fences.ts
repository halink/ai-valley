import type {Pasture} from '../shared/industry.js';
import type {World} from '../shared/types.js';
import {pastureFenceRules as rules} from '../shared/pasture-fence.js';
import {emitEvent} from './events.js';
import {DAY} from './time.js';

export function advancePastureFence(w:World,p:Pasture):void {
 if(!p.fenced||p.status==='retired')return;
 // Existing physical fences start accounting now, without inventing past damage or repairs.
 if(!p.fence){p.fence={condition:100,lastMinute:w.minute,woodUsed:0,repairs:0};return;}
 const f=p.fence,dt=Math.max(0,w.minute-f.lastMinute);if(!dt)return;
 const before=f.condition;f.lastMinute=w.minute;
 f.condition=Math.max(0,before-dt/DAY*rules.wearPerDay*(w.weather==='rain'?rules.rainMultiplier:1));
 if(before>0&&f.condition===0)emitEvent(w,{kind:'production',actors:[],place:{...(p.gate?.outside??p.tiles[0])},text:'牧场围栏因实际风雨磨损失去阻挡作用，停止新入场。原牲畜和草水留在实际位置，须由居民自行照料、护送或修护。'});
}
