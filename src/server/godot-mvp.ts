import {serveGodotWeb} from './godot-web.js';
import {roomObservation} from './room-observation.js';
import {adoptMvpRooms} from '../world/mvp-rooms.js';
import {adoptMvpDrinking,mvpThirst} from '../world/mvp-drinking.js';
import {mvpObservation} from './mvp-observation.js';
import {enableCompletedMovement,completedMovementSnapshot} from '../world/completed-movement.js';
/** Small, disposable engineering MVP. Rules choose actions; the existing world
 * engine owns pathfinding, needs, elapsed work and resource/food settlement.
 * This is NOT LLM autonomy, a formal save, or a longevity acceptance run. */
import {randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {createWorld} from '../world/seed.js';
import {stepWorld,submitPlan} from '../world/engine.js';
import {distance} from '../world/navigation.js';
import {canContactBerry} from '../world/berry-observation.js';
import {canContactSpring} from '../world/spring-observation.js';
import {VALLEY_VERSION} from '../shared/version.js';
import type {Action,Resident,Snapshot,Tile,World} from '../shared/types.js';

export const GODOT_MVP_PORT=3414;
export const GODOT_MVP_NOTICE='隔离核心循环：本地规则驱动，非真实模型；内存世界，退出后重置';
export type MvpPhase='deciding'|'travelling'|'gathering'|'eating'|'resting'|'waiting'|'stopped'|'drinking';
export function mvpPhase(r:Resident):MvpPhase {
 if(r.status!=='alive')return 'stopped';
 if(!r.activity)return 'deciding';
 if(r.activity.path.length||r.activity.room?.path.length)return 'travelling';
 return ({mvpDrink:'drinking',gather:'gathering',eat:'eating',sleep:'resting',wait:'waiting'} as const)[r.activity.action.type as 'gather'|'eat'|'sleep'|'wait']??'waiting';
}
export function createMvpWorld():World {
 const world=createWorld(3414);
 const width=32,height=24,tiles:Tile[]=Array(width*height).fill('grass');
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  if(x===0||y===0||x===width-1||y===height-1)tiles[y*width+x]='cliff';
  else if(x>=27)tiles[y*width+x]='water';
  else if(y===14||x===15&&y>=12)tiles[y*width+x]='path';
 }
 world.id='godot-mvp-'+randomUUID();
 world.map={width,height,tiles,name:'溪畔小院 · 核心循环',entrance:{x:15,y:22},settlement:{x:15,y:13}};
 world.residents=world.residents.slice(0,2);
 const home={...world.buildings.find(b=>b.id==='lodge')!,id:'mvp-home',name:'共屋',at:{x:11,y:6},width:8,height:6,door:{x:15,y:12},residents:world.residents.map(r=>r.id),capacity:2};
 world.buildings=[home];
 world.resources=[
  ...[{x:7,y:13},{x:22,y:14},{x:8,y:19},{x:21,y:20}].map((at,index)=>({id:'mvp-berry-'+index,kind:'bush' as const,at,amount:12,max:12,regrowthDays:1,lastHarvest:0})),
  {id:'mvp-spring',kind:'spring',at:{x:25,y:14},amount:10000,max:10000,regrowthDays:1,lastHarvest:0},
 ];
 world.plots=[];world.graves=[];world.events=[];
 for(const [index,r]of world.residents.entries()){
  r.at={x:14+index*2,y:14};r.homeId=home.id;r.inside=null;r.roomAt=null;
  r.inventory={};r.hunger=index===0?65:25;r.energy=index===0?85:50;
  r.knownPeople=world.residents.filter(p=>p.id!==r.id).map(p=>p.id);
  r.knownBuildings=[home.id];r.knownResources=world.resources.map(s=>s.id);
  r.intention='本地规则：观察当前需要';
 }
 world.clock={paused:false,reason:null,realMinutesPerDay:12};
 adoptMvpDrinking(world);
 adoptMvpRooms(world);
 return world;
}
/** No global information is claimed to be a resident's model knowledge. This
 * deliberately bounded engineering policy is visibly labelled in snapshots. */
export function chooseMvpAction(w:World,r:Resident):{action:Action;reason:string} {
 if(r.hunger>=35&&(r.inventory.berry??0)>0)return {action:{type:'eat',item:'berry'},reason:'饥饿且带有浆果，进食'};
 // Immediate needs come before optional stocking: an empty bag must not
 // send a thirsty or exhausted resident on a food-reserve trip.
 if(r.hunger>=35){
  const source=w.resources.filter(s=>s.kind==='bush'&&s.amount>=1&&r.knownResources.includes(s.id)).sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at))[0];
  if(source)return {action:{type:'gather',resourceId:source.id,quantity:Math.min(3,source.amount)},reason:'前往已知果丛，采集有限食物'};
 }
 if((mvpThirst(w,r)??0)>=50-1e-9){
  if((r.inventory.water??0)>=1)return {action:{type:'mvpDrink'},reason:'口渴，选择饮用一份随身清水'};
  const source=w.resources.find(s=>s.kind==='spring'&&s.amount>=1&&r.knownResources.includes(s.id));
  if(source)return {action:{type:'gather',resourceId:source.id,quantity:1},reason:'口渴且没有清水，前往泉水取一份'};
 }
 if(r.energy<70)return {action:{type:'sleep',minutes:120},reason:'返回共屋休息，恢复精力'};
 if((r.inventory.berry??0)<3){
  const source=w.resources.filter(s=>s.kind==='bush'&&s.amount>=1&&r.knownResources.includes(s.id)).sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at))[0];
  if(source)return {action:{type:'gather',resourceId:source.id,quantity:Math.min(3,source.amount)},reason:'前往已知果丛补充少量浆果储备'};
 }
 return {action:{type:'wait',minutes:30},reason:'暂时没有紧迫需要，停留观察'};
}
export function createMvpSession(){
 const world=createMvpWorld();
 enableCompletedMovement(world);
 let serial=0,fault:string|null=null;
 const decisions:Record<string,number>={};
 const snapshot=():Snapshot&{roomViews:ReturnType<typeof roomObservation>}&{observation:ReturnType<typeof mvpObservation>}&{movement:ReturnType<typeof completedMovementSnapshot>}&{mvp:{driver:'local-rules';notice:string;ephemeral:true;fault:string|null;phases:Record<string,MvpPhase>;decisions:Record<string,number>}}=>({
  roomViews:roomObservation(world),observation:mvpObservation(world,[],[]),movement:completedMovementSnapshot(world),world:structuredClone(world),serverTime:new Date().toISOString(),version:VALLEY_VERSION,mapRevision:'godot-mvp-map-1',
  capabilities:{active:['小地图只读观察','本地规则采集/进食/休息闭环'],pending:['真实模型决策验收','持久存档','最终绘本素材']},
  mvp:{driver:'local-rules',notice:GODOT_MVP_NOTICE,ephemeral:true,fault,phases:Object.fromEntries(world.residents.map(r=>[r.id,mvpPhase(r)])),decisions:{...decisions}},
 });
 const advance=(minutes=1)=>{
  if(!Number.isInteger(minutes)||minutes<1||minutes>60)throw new Error('MVP advances must be 1–60 whole world minutes');
  if(fault)return;
  try{
   for(let tick=0;tick<minutes;tick++){
    for(const r of world.residents){
     if(r.status!=='alive'||r.activity||r.plan)continue;
     const choice=chooseMvpAction(world,r);
     const result=submitPlan(world,{id:`mvp-rule-${++serial}`,actorId:r.id,actorRevision:r.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'本地规则：'+choice.reason,actions:[choice.action]});
     if(!result.ok)throw new Error(`MVP plan rejected for ${r.id}: ${result.error}`);
     decisions[r.id]=(decisions[r.id]??0)+1;
    }
    // A neighbour may finish harvesting after this resident chose a source.
    // Keep the engine's rejected action (no inventory credit), then let the
    // next tick choose from current stock instead of freezing the whole demo.
    const gathering=new Map(world.residents.map(r=>[r.id,r.activity?.action]));
    stepWorld(world,1);
    for(const failed of world.residents.filter(r=>r.lastFailure)){
     const action=gathering.get(failed.id);
     const source=action?.type==='gather'?world.resources.find(s=>s.id===action.resourceId):undefined;
     const depleted=action?.type==='gather'&&source&&source.amount<action.quantity&&distance(failed.at,source.at)<=1
      &&(source.kind!=='bush'||canContactBerry(world,failed,source))
      &&(source.kind!=='spring'||canContactSpring(world,failed,source));
     if(failed.lastFailure==='资源或实际位置已经变化'&&depleted)continue;
     throw new Error(`MVP action failed for ${failed.id}: ${failed.lastFailure}`);
    }
   }
  }catch(error){fault=error instanceof Error?error.message:String(error);world.clock.paused=true;world.clock.reason=fault;world.revision++;}
 };
 return {world,snapshot,advance};
}
export function createMvpServer(session:ReturnType<typeof createMvpSession>,options:{webRoot?:string}={}):Server {
 return createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(options.webRoot&&serveGodotWeb(req,res,options.webRoot))return;
  if(req.method!=='GET'){res.writeHead(405,{'Allow':'GET'});res.end('Read-only MVP');return;}
  if(req.url!=='/ai-town/api/world'){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(session.snapshot()));
 });
}
