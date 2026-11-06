import type {CraftRecipe,StationKind} from '../shared/industry.js';
import type {Inventory} from '../shared/types.js';
export const stationNames:Record<StationKind,string>={bench:'木工作台',forge:'锻冶炉',mill:'磨坊工位',dairy:'乳品工位',loom:'织机',preserver:'罐藏工位'};
export const stationCosts:Record<StationKind,Inventory>={bench:{wood:8,stone:2},forge:{stone:12,wood:4},mill:{wood:8,stone:8},dairy:{wood:8,stone:4},loom:{wood:10},preserver:{wood:6,stone:6}};
export const recipes:CraftRecipe[]=[
 {id:'axe',name:'手制斧具',input:{wood:3,stone:2},output:{axeKit:1},minutes:45,station:null,skill:'building',minimum:0},
 {id:'pick',name:'手制镐具',input:{wood:3,stone:3},output:{pickKit:1},minutes:60,station:null,skill:'building',minimum:0},
 {id:'rod',name:'手制钓具',input:{wood:2,fiber:2},output:{rodKit:1},minutes:45,station:null,skill:'building',minimum:0},
 {id:'spear',name:'打制猎矛',input:{wood:3,stone:2,fiber:1},output:{spearKit:1},minutes:55,station:null,skill:'building',minimum:0},
 {id:'fiber',name:'整理植物纤维',input:{wood:1},output:{fiber:3},minutes:20,station:null,skill:'farming',minimum:0},
 {id:'sapling',name:'育成果树苗',input:{seed:2,wood:1,water:2},output:{sapling:1},minutes:90,station:null,skill:'farming',minimum:0},
 {id:'fodder',name:'配制饲料',input:{turnip:1,fiber:1},output:{fodder:4},minutes:20,station:null,skill:'farming',minimum:0},
 {id:'compost',name:'制作畜粪堆肥',input:{manure:2,fiber:1,water:1},output:{compost:1},minutes:90,station:null,skill:'farming',minimum:0},
 {id:'herb',name:'整理草木药材',input:{berry:2,water:1},output:{herb:1},minutes:30,station:null,skill:'care',minimum:0},
 {id:'plank',name:'锯制木板',input:{wood:3},output:{plank:2},minutes:40,station:'bench',skill:'building',minimum:0},
 {id:'bar',name:'冶炼铁锭',input:{ore:2,coal:1},output:{bar:1},minutes:90,station:'forge',skill:'building',minimum:1},
 {id:'bread',name:'烘制谷物面包',input:{grain:2,water:1,wood:1},output:{bread:2},minutes:40,station:'mill',skill:'farming',minimum:0},
 {id:'fishMeal',name:'烹制鱼餐',input:{fish:1,water:1,wood:1},output:{meal:2},minutes:30,station:null,skill:'farming',minimum:0},
 {id:'gameMeal',name:'烹熟猎肉',input:{gameMeat:1,water:1,wood:1},output:{meal:2},minutes:35,station:null,skill:'farming',minimum:0},
 {id:'cheese',name:'加工奶酪',input:{milk:2},output:{cheese:1},minutes:60,station:'dairy',skill:'farming',minimum:0},
 {id:'preserve',name:'制作水果罐藏',input:{fruit:2,water:1,wood:1},output:{preserve:2},minutes:60,station:'preserver',skill:'farming',minimum:0},
 {id:'cloth',name:'纺织布料',input:{fiber:3,wool:1},output:{cloth:2},minutes:60,station:'loom',skill:'building',minimum:0},
 {id:'medicine',name:'配制照护用品',input:{herb:2,water:1,cloth:1},output:{medicine:2},minutes:45,station:null,skill:'care',minimum:1},
];
export const recipeById=(id?:string)=>recipes.find(r=>r.id===id);
