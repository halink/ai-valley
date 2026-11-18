/** Saved, one-time small-valley provision budget, not automatic population grants. */
export interface MvpResources {
 version:1;adoptedAt:number;lastMinute:number;population:number;
 foodNeedPerDay:number;waterNeedPerDay:number;
 daily:{berry:number;fruit:number;water:number;wood:number;stone:number};
 initial:{berryTarget:number;fruit:number;water:number;wood:number;stone:number;plots:number};
 renewal:Record<string,{perDay:number;progress:number}>;
 addedResourceIds:string[];addedPlotIds:string[];
}
