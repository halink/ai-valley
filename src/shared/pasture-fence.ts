import type {Pasture} from './industry.js';

export const pastureFenceRules={wearPerDay:4,rainMultiplier:1.5,repairWood:4,repairMinutes:60,repairRestore:40,repairBelow:70};
/** Old fenced snapshots retain their barrier; unfenced pastures never gain one. */
export const pastureFenceCondition=(p:Pasture)=>p.fence?.condition??100;
export const pastureFenceBlocks=(p:Pasture)=>!!p.fenced&&p.status!=='retired'&&pastureFenceCondition(p)>0;
