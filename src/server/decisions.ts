import {aboardFerry,ferryOpportunities} from '../world/ferry.js';
import {buildingMigrationOpportunities} from '../world/building-migration.js';
import {promiseNotes,promiseOpportunities,localPromiseChoices} from '../world/known-promises.js';
import {cultureOpportunities} from './culture-opportunities.js';
import {socialOpportunities} from '../world/social-life.js';
import {coLocated} from '../world/proximity.js';
import {householdOpportunities,householdNotes} from '../world/household.js';
import {debtOpportunities} from '../world/debt.js';
import {adoptionOpportunities} from '../world/adoption.js';
import {agencyOpportunities,focusedChoices} from './agency-opportunities.js';
import {focusNames,repeatsActiveGoal} from '../shared/agency.js';
import {physiologyDefaults} from '../shared/physiology.js';
import {residentBed} from '../shared/rooms.js';
import {deathProof} from '../world/knowledge.js';
import {funeraryOpportunities} from './funerary-opportunities.js';
import {longCareOpportunities,longCareNotes} from './long-care-opportunities.js';
import {passenger} from '../world/medical-transport.js';
import {healthOpportunities,healthNotes} from './health-opportunities.js';
import {designOpportunities} from './design-opportunities.js';
import {industryOpportunities} from './industry-opportunities.js';
import {itemKeys,goods} from '../shared/items.js';
import {educationOpportunities,educationNotes} from './education-opportunities.js';
import type { Action, DecisionContext, ModelDecision, Resident, World } from '../shared/types.js';
import {dutyOpportunities} from './duty-opportunities.js';
import {personalObservations} from './personal-observations.js';
import {familyOpportunities} from './family-opportunities.js';
import {economyOpportunities,economyNotes} from './economy-opportunities.js';
import {civicOpportunities,civicNotes} from './civic-opportunities.js';
import {productionOpportunities} from './production-opportunities.js';
import {employmentOpportunities,employmentNotes} from './employment-opportunities.js';
import {foreignOpportunities,foreignNotes} from './foreign-opportunities.js';
import {constructionOpportunities,constructionNotes} from './construction-opportunities.js';
import {calendar,daylight,daylightLabels,ageYears,FAST_DAY_MINUTES} from '../world/time.js';
import {formalOpportunities} from './formal-opportunities.js';
import {buildChoices,parseChoice,type ActionChoice} from './affordances.js';
import {frontierHazardNotes,frontierHazardOpportunities} from './frontier-hazard-opportunities.js';
import {completeModel,checkedInputBytes,QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL,type ModelName,type ModelMessage} from './model-completion.js';

const items = new Set<string>(itemKeys);
const activeTypes = new Set(['move','wait','gather','plant','water','harvest','eat','sleep','cook','talk','offer','accept']);
const kinds = new Set(['home','lodge','workshop','clinic','school','barn','greenhouse','store']);
function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function finite(v:unknown,min:number,max:number){return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;}
function id(v:unknown){return typeof v==='string'&&v.length>0&&v.length<=100;}
function point(v:unknown){return record(v)&&Number.isInteger(v.x)&&Number.isInteger(v.y)&&Number.isSafeInteger(v.x)&&Number.isSafeInteger(v.y)&&Number(v.x)>=0&&Number(v.y)>=0;}
function bag(v:unknown){return record(v)&&Object.keys(v).length<=items.size&&Object.entries(v).every(([k,n])=>items.has(k)&&Number.isInteger(n)&&finite(n,1,100));}
/** Deliberately finite phase-two vocabulary. Lifecycle foundations are exercised separately. */
export function parseDecision(raw:string):ModelDecision{
 let body=raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
 const parsed:unknown=JSON.parse(body);
 if(!record(parsed)||typeof parsed.intention!=='string'||!parsed.intention.trim()||parsed.intention.length>160||!Array.isArray(parsed.actions)||parsed.actions.length<1||parsed.actions.length>8) throw new Error('invalid_decision');
 const actions:Action[]=[];
 for(const a of parsed.actions){
  if(!record(a)||typeof a.type!=='string'||!activeTypes.has(a.type))throw new Error('unsupported_action');
  let valid=false;
  switch(a.type){
   case 'move':valid=point(a.to);break;
   case 'wait':case 'sleep':valid=finite(a.minutes,5,480)&&Number.isInteger(a.minutes);break;
   case 'gather':valid=id(a.resourceId)&&Number.isInteger(a.quantity)&&finite(a.quantity,1,10);break;
   case 'plant':case 'water':case 'harvest':valid=id(a.plotId);break;
   case 'eat':valid=itemKeys.includes(a.item as keyof typeof goods)&&goods[a.item as keyof typeof goods].food>0;break;
   case 'cook':valid=Number.isInteger(a.quantity)&&finite(a.quantity,1,5);break;
   case 'talk':valid=id(a.targetId)&&typeof a.text==='string'&&a.text.trim().length>0&&a.text.length<=240&&['friendly','neutral','hostile'].includes(String(a.tone));break;
   case 'build':valid=kinds.has(String(a.kind))&&point(a.at);break;
   case 'offer':valid=id(a.targetId)&&bag(a.give)&&bag(a.want)&&(Object.keys(a.give as object).length+Object.keys(a.want as object).length)>0;break;
   case 'accept':valid=id(a.offerId);break;
  }
  if(!valid)throw new Error('invalid_action');
  actions.push(a as Action);
 }
 return {intention:parsed.intention.trim(),actions};
}
export function decisionContext(world:World,actor:Resident):DecisionContext{
 const nearby=(p:Resident)=>p.id!==actor.id&&p.residency!=='outside'&&coLocated(world,actor,p,10);
 const seen=world.residents.filter(nearby).filter(p=>p.status==='alive'||!!deathProof(world,actor,p.id));
 const visibleActivity=(p:Resident)=>p.activity?.path.length||p.activity?.room?.path.length?'正在行走':p.activity?({gather:'正在采集',plant:'正在播种',water:'正在浇水',harvest:'正在收获',eat:'正在进食',sleep:'正在睡眠',cook:'正在烹饪',talk:'正在说话'} as Record<string,string>)[p.activity.action.type]??'正在活动':'在附近';
 const familyNotes=[frontierHazardNotes(world,actor),promiseNotes(world,actor),householdNotes(world,actor),longCareNotes(world,actor),healthNotes(world,actor),personalObservations(world,actor),economyNotes(world,actor),civicNotes(world,actor),employmentNotes(world,actor),foreignNotes(world,actor),constructionNotes(world,actor),educationNotes(world,actor)].filter(Boolean).join(' ');
 const home=world.buildings.find(b=>b.id===actor.homeId&&b.condition>0&&b.residents.includes(actor.id));
 const sleepEnergy=world.definitions[actor.physiologyDefinition??'life/physiology@1']?.data.sleepEnergy;
 return {
  ...(world.mode==='formal'?{formal:{aboard:!!aboardFerry(world,actor.id),passenger:!!passenger(world,actor.id),frontier:world.scenario==='frontier',age:Math.floor(ageYears(actor.bornAt,world.minute)),productiveFarming:Boolean(world.production),familyNotes,
    hasBed:!!home&&(!world.rooms||residentBed(world,actor,home)!==null),sleepRecoveryPerHour:60*(typeof sleepEnergy==='number'?sleepEnergy:physiologyDefaults.sleepEnergy),
    planSteps:world.clock.realMinutesPerDay<=FAST_DAY_MINUTES?3:1,
    opportunities:[...frontierHazardOpportunities(world,actor),...ferryOpportunities(world,actor),...buildingMigrationOpportunities(world,actor),...promiseOpportunities(world,actor),...localPromiseChoices(world,actor,[...agencyOpportunities(world,actor),...adoptionOpportunities(world,actor),...debtOpportunities(world,actor),...householdOpportunities(world,actor),...socialOpportunities(world,actor),...cultureOpportunities(world,actor),...funeraryOpportunities(world,actor),...longCareOpportunities(world,actor),...healthOpportunities(world,actor),...formalOpportunities(world,actor,seen),...familyOpportunities(world,actor),...dutyOpportunities(world,actor),...economyOpportunities(world,actor),...civicOpportunities(world,actor),...productionOpportunities(world,actor),...employmentOpportunities(world,actor),...foreignOpportunities(world,actor),...constructionOpportunities(world,actor),...educationOpportunities(world,actor),...industryOpportunities(world,actor),...designOpportunities(world,actor)])]}}:{}),
  actor:{id:actor.id,name:actor.name,traits:actor.traits,hunger:Math.round(actor.hunger),energy:Math.round(actor.energy),health:Math.round(actor.health),inventory:{...actor.inventory},coins:actor.coins,skills:{...actor.skills},intention:actor.intention,at:{...actor.at},homeId:actor.homeId,lastFailure:actor.lastFailure,agency:actor.agency?structuredClone(actor.agency):undefined,recentActions:actor.recentActions?.map(a=>({...a}))},
  bounds:{width:world.map.width,height:world.map.height},minute:world.minute,season:calendar(world.minute).season,weather:world.weather,
  people:seen.map(p=>({id:p.id,name:p.name,at:{...p.at},inside:p.inside,roomAt:p.roomAt?{...p.roomAt}:null,intention:visibleActivity(p),status:p.status,relation:actor.relations.find(r=>r.targetId===p.id)??null})),
  buildings:world.buildings.filter(b=>actor.knownBuildings.includes(b.id)).map(b=>({...b,residents:b.residents.filter(id=>id===actor.id||seen.some(p=>p.id===id))})),
  resources:world.resources.filter(r=>actor.inside===null&&actor.knownResources.includes(r.id)&&Math.hypot(actor.at.x-r.at.x,actor.at.y-r.at.y)<=12).map(r=>({...r})),
  plots:world.plots.filter(p=>actor.inside===null&&Math.hypot(actor.at.x-p.at.x,actor.at.y-p.at.y)<=8),
  knownLand:world.plots.filter(p=>p.ownerId===actor.id).map(p=>({id:p.id,at:{...p.at}})),
  offers:world.offers.filter(o=>(o.actorId===actor.id||o.targetId===actor.id)&&o.status==='open'),
  proposals:world.proposals.filter(p=>(p.actorId===actor.id||p.targetId===actor.id)&&p.status==='open'),
  memories:actor.memories.slice(-18)
 };
}
function compactForeignChoices(context:DecisionContext,all:ActionChoice[]){if(!context.foreign)return all;const selected=all.filter(c=>c.action.type==='foreignTrade'&&['accept','reject','cancelOffer','cancelShipment','wait'].includes(c.action.operation)),rotate=(rows:ActionChoice[],limit:number)=>{const start=Math.floor(context.minute/30)%Math.max(1,rows.length);return Array.from({length:Math.min(rows.length,limit)},(_,i)=>rows[(start+i)%rows.length]);};return [...selected,...rotate(all.filter(c=>c.action.type==='foreignTrade'&&c.action.operation==='produce'),4),...rotate(all.filter(c=>c.action.type==='foreignTrade'&&c.action.operation==='post'&&c.action.side==='import'),4),...rotate(all.filter(c=>c.action.type==='foreignTrade'&&c.action.operation==='post'&&c.action.side==='export'),4)];}
export function decisionChoices(context:DecisionContext):ActionChoice[]{
 let choices=compactForeignChoices(context,focusedChoices(context,buildChoices(context)));
 if(context.formal&&!context.formal.aboard&&!context.formal.passenger&&choices.length>1){
  // Rotate presentation only. The same set of eligible actions is offered to the resident.
  let offset=0;for(const ch of context.actor.id)offset=(offset*31+ch.charCodeAt(0))>>>0;
  offset=(offset+Math.floor(context.minute/30))%choices.length;
  choices=[...choices.slice(offset),...choices.slice(0,offset)];
 }
 return choices.map((c,i)=>{
  const a=structuredClone(c.action);
  const id='targetId'in a?a.targetId:a.type==='accept'?context.offers.find(o=>o.id===a.offerId)?.actorId:a.type==='respond'?context.proposals.find(p=>p.id===a.proposalId)?.actorId:undefined;
  const p=context.people.find(p=>p.id===id);
  if(p&&['talk','care','learn','offer','accept','propose','respond'].includes(a.type))a.observedTarget={id:p.id,at:{...p.at},inside:p.inside??null,roomAt:p.roomAt?{...p.roomAt}:null,atMinute:context.minute};
  return {...c,action:a,id:String(i+1)};
 });
}
export function prompt(context:DecisionContext,choices=decisionChoices(context),feedback?:string,model:ModelName=GLM_MODEL):ModelMessage[]{
 const a=context.actor,t=calendar(context.minute);
 if(context.foreign){
  return [{role:'user',content:`你是${context.foreign.origin}的商人${a.name}。你有${a.coins??0}钱、实物${JSON.stringify(a.inventory)}。请替本人决定一件事。
${choices.map(c=>c.id+'. '+c.label).join('\n')}
直接输出一行数字：普通选择只写编号，例如 1。需填数量时写 编号,数量，例如 3,2。需填写数量和单价时写 编号,数量,单价，例如 5,2,7。不写解释。`}];
 }
 if(context.outside){
  return [{role:'user',content:`你是住在${context.outside.origin}的${a.name}。性格：${a.traits.join('、')}。体力 ${a.energy}/100，健康 ${a.health}/100，随身物品 ${JSON.stringify(a.inventory)}。你收到的消息：${context.outside.notice}。
${context.memories.length?'你自己记得的经历：'+context.memories.slice(-3).map(memory=>memory.text).join('；'):''}
只替自己决定是否启程。选择留下或以后再考虑也完全由你。可选行动：
${choices.map(c=>c.id+'. '+c.label).join('\n')}
只返回 JSON {"choice":"你的编号","intention":"你自己的简短打算"}。` }];
 }
 const notes=context.formal?.familyNotes?.slice(0,model===QWEN_MODEL?32_000:model===DEEPSEEK_MODEL?6000:16_000)??'';
 const state=`你是居民${a.name}${context.formal?'，'+context.formal.age+'岁':''}。性格：${a.traits.join('、')}。现在${context.season}季第${t.day}天${t.hour}时${t.minute}分（${daylightLabels[daylight(context.minute).phase]}），${context.weather==='rain'?'下雨':'晴天'}。饥饿${a.hunger}/100（越高越饿），体力${a.energy}/100，健康${a.health}/100。掌握技能：农事${a.skills.farming.toFixed(2)}、建造${a.skills.building.toFixed(2)}、照护${a.skills.care.toFixed(2)}。自有物品${JSON.stringify(a.inventory)}，自己的钱款${a.coins??0}。${notes}`;
 const goal=a.agency?.goals.find(g=>g.status==='active');
 const ownProgram=goal?'你持续记得自己写下的目标：'+goal.text+'。近期关注'+focusNames[goal.focus]+'。这个目标已经生效，可以直接选行动。你也可以改变目标、拒绝或退出他人的提议。':'';
 const memory=context.memories.slice(model===QWEN_MODEL?-6:-3).map(m=>m.text.slice(0,120)).join('；');
 const recent=a.recentActions?.filter(record=>context.minute-record.at<1440)??[];
 const restHistory=recent.some(record=>record.type==='sleep'||record.type==='wait')?`你最近完成的行动（从早到晚）：${recent.map(record=>{
  const when=Math.floor(context.minute-record.at);
  const activity=record.type==='sleep'?`睡了${record.minutes}分钟` : record.type==='wait'?`原地停留了${record.minutes}分钟`:'完成其他行动';
  return `${when}分钟前${activity}${record.energy===undefined?'':`，当时体力${record.energy}/100`}`;
 }).join('；')}。`:'';
 const hasGoals=choices.some(c=>c.action.type==='agency'&&['reflect','conclude'].includes(c.action.operation));
 const chooseDuration=choices.some(c=>c.chooseDuration);
 const steps=maxPlanSteps(context);
 const sequence=steps>1?`若已有连贯安排，可以用 {"steps":[{"choice":"第一个编号"},{"choice":"第二个编号"}]} 按顺序选最多${steps}项。每一步自行填写该选项要求的字段。只确定第一步时，仍可只选一项。`:'';
 const recovery=choices.some(c=>c.action.type==='sleep'&&c.chooseDuration)&&context.formal?.sleepRecoveryPerHour!==undefined?`实际睡眠每小时约恢复${Math.round(context.formal.sleepRecoveryPerHour*10)/10}点体力，上限100。原地停留不会恢复睡眠体力。`:'';
 return [{role:'user',content:`只输出一个 JSON 对象，直接选择实际列出的编号；没有要求的字段不填写。
${state}
${context.formal?.frontier?'你生活在一座来往稀少的山间小村。食物、水和饲料要从实际库存、采集、生产或互助中获得。留意亲身可见的险情、天气和回村路程。':''}
${ownProgram}
${restHistory}${recovery}
${a.lastFailure?'上次行动未成：'+a.lastFailure+'。':''}${memory?'你的记忆：'+memory:''}
${feedback?`上一份回复未能执行。${feedback}你仍可选择任何当前列出的行动。`:''}
请自主选择下面的行为。你也可先写自己的长期目标以聚焦某个领域，或自愿接受有限日常分支，系统不会替你设目标。只为你自己决定，不代替别人说话或同意。规则负责走路和执行，不会替你选择。
${choices.map(c=>`${c.id}. ${c.label}`).join('\n')}
无需额外内容的选项用 {"choice":"选中的编号"}。${sequence}${chooseDuration?'选择注明填写 minutes 的睡眠或停留时，必须同时填写本人决定的整数分钟，1–720。':''}${hasGoals?'如果选择写目标或回顾目标，必须返回 {"choice":"选中的编号","text":"你本人写下的目标或感想"}，不能只给编号。':''}说话时加text写你自己的一句话；交换提议加give和want写物品与数量；其他选项按各自注明的字段填写。只输出JSON，不要解释或Markdown。`}];
}
function maxPlanSteps(context:DecisionContext){const formal=context.formal;return formal&&!formal.aboard&&!formal.passenger?formal.planSteps??1:1;}
export interface ModelResult {decision:ModelDecision;inputTokens:number;outputTokens:number;latencyMs:number;}
export class DecisionError extends Error {constructor(message:string,public stats:{inputTokens:number;outputTokens:number;latencyMs:number},public feedback?:string){super(message);}}
export function parseForeignReply(raw:string,choices:ActionChoice[]){const body=raw.trim();if(body.startsWith('{')||body.startsWith('```'))return parseChoice(body,choices);const match=/^([1-9]\d{0,2})(?:[,，]\s*([1-9]\d{0,2}))?(?:[,，]\s*([1-9]\d{0,3}))?$/.exec(body);if(!match)throw new Error('invalid_foreign_reply');const [,choice,quantity,price]=match;return parseChoice(JSON.stringify({choice,...(quantity?{quantity:Number(quantity)}:{}),...(price?{price:Number(price)}:{})}),choices);}
export function prepareModelDecision(context:DecisionContext,feedback:string|undefined,model:ModelName){
 const choices=decisionChoices(context);
 const messages=prompt(context,choices,feedback,model);
 return {choices,messages,inputBytes:checkedInputBytes(model,messages)};
}
export async function callModel(key:string,context:DecisionContext,feedback?:string,model:ModelName=GLM_MODEL,prepared=prepareModelDecision(context,feedback,model)):Promise<ModelResult>{
 const started=Date.now();const {choices,messages}=prepared;
 const reply=await completeModel(key,model,messages,context.foreign?0.6:0.25);
 const stats={inputTokens:reply.usage?.prompt_tokens??0,outputTokens:reply.usage?.completion_tokens??0,latencyMs:Date.now()-started};
 if(!reply.content.trim()||reply.finish!=='stop')throw new DecisionError('model_incomplete',stats);
 try{
  const decision=context.foreign?parseForeignReply(reply.content,choices):parseChoice(reply.content,choices,maxPlanSteps(context));
  if(decision.actions.some(action=>action.type==='agency'&&repeatsActiveGoal(context.actor.agency,action)))throw new Error('repeated_active_goal');
  return {decision,...stats};
 }
 catch(error){
  const code=error instanceof Error?error.message:'';
  const feedback=code==='invalid_personal_goal'
   ?'你选择了写目标或回顾目标，但没有给出合格的 text。若仍作此选择，请写出自己的文字（1–240字）。'
   :code==='invalid_rest_duration'?'选择了需要时长的睡眠或停留。若仍作此选择，请填写 minutes，取值为本人决定的 1–720 整数分钟。'
   :code==='repeated_active_goal'?'同一个目标已生效，无需再登记。请决定接下来做什么；如果改变了目标，可以写下新的打算。'
   :'请检查选项编号和该行要求的字段，按要求填全并只输出一个 JSON 对象。';
  throw new DecisionError('invalid_decision',stats,feedback);
 }
}
