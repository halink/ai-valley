import type {Vec} from './types.js';

export const FORMAL_WIDTH = 640;
export const FORMAL_HEIGHT = 480;
export const FORMAL_CENTER = {x: 320, y: 240};

interface Region {
  id: string;
  name: string;
  bounds: {x:number; y:number; width:number; height:number};
  landmark: Vec;
}

export const FORMAL_REGIONS: readonly Region[] = [
  {id:'ridge', name:'西北山林', bounds:{x:0,y:0,width:320,height:144}, landmark:{x:164,y:78}},
  {id:'lake', name:'东北湖区与矿口', bounds:{x:320,y:0,width:320,height:144}, landmark:{x:491,y:94}},
  {id:'fields', name:'西岸农地', bounds:{x:0,y:144,width:208,height:192}, landmark:{x:158,y:238}},
  {id:'village', name:'中央谷地', bounds:{x:208,y:144,width:240,height:192}, landmark:FORMAL_CENTER},
  {id:'east-bank', name:'东岸台地', bounds:{x:448,y:144,width:192,height:192}, landmark:{x:508,y:241}},
  {id:'forest-road', name:'西南林道', bounds:{x:0,y:336,width:320,height:144}, landmark:{x:96,y:394}},
  {id:'estuary', name:'东南河口与海岸', bounds:{x:320,y:336,width:320,height:144}, landmark:{x:526,y:399}},
];
