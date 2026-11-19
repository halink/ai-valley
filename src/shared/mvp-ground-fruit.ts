import type {Vec} from './types.js';

/** Separate finite ground food, never a regenerating Resource or resident inventory. */
export interface MvpGroundFruit {
 readonly effectId:string;
 readonly kind:'fallen-fruit';
 readonly amount:1;
 readonly ownerId:'commons';
 readonly sourceResourceId:string;
 readonly sourceResourceInstanceId:string;
 readonly sourceAt:Vec;
 readonly rainEventId:string;
 readonly at:Vec;
 readonly placedUs:string;
}
export interface MvpGroundFruitState {
 readonly version:1;
 readonly items:readonly MvpGroundFruit[];
}
