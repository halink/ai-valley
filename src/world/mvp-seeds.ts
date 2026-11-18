import {foodFlowInputs,recordFoodFlow} from './food-consumption-evidence.js';
import type {World,Resident,Action} from '../shared/types.js';
import {hasMvpHamlet,MVP_HALL} from '../shared/mvp-hamlet.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import {emitEvent} from './events.js';

export const isMvpSeedAction=(a:Action):a is Extract<Action,{type:'mvpCollectSeed'|'mvpSaveSeed'}>=>a.type==='mvpCollectSeed'||a.type==='mvpSaveSeed';
export function validateMvpSeeds(w:World):void {
 const s=w.mvpSeeds;if(s===undefined)return;
 const record=(v:unknown):v is Record<string,number>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).every(([id,n])=>w.residents.some(r=>r.id===id)&&Number.isSafeInteger(n)&&n>=0);
 if(!s||!hasMvpHamlet(w)||w.mvpRooms?.version!==1||s.version!==1||s.initial!==8||!Number.isFinite(s.adoptedAt)||s.adoptedAt<0||s.adoptedAt>w.minute||!Number.isSafeInteger(s.stock)||s.stock<0||s.stock>8||!record(s.claimed)||!record(s.saved)||s.stock+Object.values(s.claimed).reduce((a,b)=>a+b,0)!==8)throw Error('godot_mvp_invalid_seed_reserve');
}
export function adoptMvpSeeds(w:World):boolean {
 if(!hasMvpHamlet(w)||w.mvpRooms?.version!==1)return false;
 validateMvpSeeds(w);if(w.mvpSeeds)return false;
 w.mvpSeeds={version:1,adoptedAt:w.minute,initial:8,stock:8,claimed:{},saved:{}};
 emitEvent(w,{kind:'action',actors:[],place:{...w.buildings.find(b=>b.id===MVP_HALL)!.door},text:'山居灶堂备下8份有限芜菁种子，可到种台逐份领取；此种源不自动补充。'});
 return true;
}
export function mvpSeedPlace(w:World){
 if(!hasMvpHamlet(w)||w.mvpRooms?.version!==1||!w.mvpSeeds)return null;
 const building=w.buildings.find(b=>b.id===MVP_HALL);if(!building||building.condition<=0)return null;
 const layout=roomLayout(w,building),slot=layout.slots.find(s=>s.key==='mvp-seed');
 return slot?{building,layout,at:slot.at}:null;
}
/** A known address permits an attempt, not remote inspection of shared stock. */
export function mvpSeedReason(w:World,r:Resident,a:Extract<Action,{type:'mvpCollectSeed'|'mvpSaveSeed'}>,onSite=false):string|null {
 const place=mvpSeedPlace(w);
 if(!place||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress||!r.knownBuildings.includes(MVP_HALL))return '当前没有可使用的山居灶堂种台';
 const from=r.inside===MVP_HALL?r.roomAt:place.layout.entry;
 if(!from||place.layout.blocked.some(p=>p.x===from.x&&p.y===from.y)||roomPath(place.layout,from,place.at)===null)return '灶堂种台的实际室内路线不可达';
 if(onSite&&(r.inside!==MVP_HALL||r.at.x!==place.building.door.x||r.at.y!==place.building.door.y||r.roomAt?.x!==place.at.x||r.roomAt?.y!==place.at.y))return '尚未实际到达灶堂种台';
 if(a.type==='mvpSaveSeed'&&(!Number.isFinite(r.inventory.turnip)||(r.inventory.turnip??0)<1))return '留种需要本人一份实际芜菁';
 if(a.type==='mvpCollectSeed'&&(onSite||r.inside===MVP_HALL)&&w.mvpSeeds!.stock<1)return '灶堂有限种源已领完';
 return null;
}
export function completeMvpSeed(w:World,r:Resident,a:Extract<Action,{type:'mvpCollectSeed'|'mvpSaveSeed'}>):string|null {
 const error=mvpSeedReason(w,r,a,true);if(error)return error;
 const s=w.mvpSeeds!;
 const inputs=a.type==='mvpSaveSeed'?foodFlowInputs(w,'person:'+r.id,{turnip:1},1):undefined;
 if(a.type==='mvpCollectSeed'){
  s.stock--;s.claimed[r.id]=(s.claimed[r.id]??0)+1;r.inventory.seed=(r.inventory.seed??0)+1;
 }else{
  r.inventory.turnip!-=1;r.inventory.seed=(r.inventory.seed??0)+2;s.saved[r.id]=(s.saved[r.id]??0)+1;
 }
 const event=emitEvent(w,{kind:'production',actors:[r.id],place:{...r.at},roomId:r.inside,roomAt:{...r.roomAt!},text:a.type==='mvpCollectSeed'?`${r.name}在灶堂种台领取1份芜菁种子，有限种源余${s.stock}份。`:`${r.name}在灶堂种台用本人1份芜菁完成留种，得到2份种子。`});
 if(a.type==='mvpSaveSeed'&&inputs&&r.activity)recordFoodFlow(w,{type:'processed',action:'saveSeed',at:w.minute,residentId:r.id,eventId:event.id,planId:r.activity.planId,container:'person:'+r.id,definition:r.activity.definition,inputs,output:{seed:2}});
 return null;
}
