import type {Vec} from './types.js';

export const animalActivities={
 forage:'觅食',drink:'寻找清水',rest:'休息',flee:'躲避危险',hunt:'追猎',raid:'接近村落',
 defend:'警戒',roam:'巡视领地',shelter:'在畜舍内',transport:'被护送',
} as const;

export interface AnimalActivity {
 kind:keyof typeof animalActivities;
 reason:string;
 target?:Vec;
 targetId?:string;
}
