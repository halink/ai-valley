import type {DecisionContext,FormalOpportunity,Resident,World} from '../shared/types.js';import type {AgencyAction,Focus} from '../shared/agency.js';import {focusNames} from '../shared/agency.js';import {agencyReason} from '../world/agency.js';import {itemKeys,itemLabels,goods} from '../shared/items.js';import type {ActionChoice} from './affordances.js';
export function agencyOpportunities(w:World,r:Resident):FormalOpportunity[]{
 const result:FormalOpportunity[]=[],add=(id:string,label:string,a:AgencyAction)=>{if(!agencyReason(w,r,a))result.push({id:'agency.'+id,label,action:a});};
 for(const focus of Object.keys(focusNames) as Focus[])add('reflect.'+focus,`写本人目标并关注${focusNames[focus]}；填text，可随时改变`,{type:'agency',operation:'reflect',focus,text:'本人准备考虑新的目标'});
 add('conclude','回顾并结束自己的当前目标，填写text（1–240字）表达自己的理解，不会自动完成任何工程或关系',{type:'agency',operation:'conclude',text:'我对过去的目标有了自己的看法'});
 for(const a of [...itemKeys.filter(i=>goods[i].food>0).map(item=>({type:'eat' as const,item})),...[120,360].map(minutes=>({type:'sleep' as const,minutes}))])add('arm.'+(a.type==='eat'?a.item:a.minutes),`本人预先决定${a.type==='eat'?'饥饿达到指定值时吃1份自有'+itemLabels[a.item]:'体力低于指定值时回自己的床睡'+a.minutes+'分钟'}；填写threshold 1–95、days 1–7、uses 1–14、cooldown 60–1440。仅空闲且不占用已接受的工作、学习、照护或活动窗口时按本人条件行动，失败停止，不替换资源或住处`,{type:'agency',operation:'arm',routineAction:a,threshold:50,days:1,uses:1,cooldown:120});
 for(const p of r.agency?.routines??[])add('disarm.'+p.id,'撤销本人先前接受的'+(p.action.type==='eat'?'进食':'睡眠')+'后续分支，保留已经实际发生的行为',{type:'agency',operation:'disarm',routineId:p.id});
 return result;
}
function domain(c:ActionChoice):Focus {
 const a=c.action;
 if(['eat','sleep','wait','cook'].includes(a.type))return 'daily';
 if(['plant','water','harvest','gather','production'].includes(a.type))return 'farming';
 if(a.type==='design')return a.operation==='draw'&&a.kind==='building'?'construction':'industry';
 if(a.type==='industry')return 'industry';if(['debt','foreignTrade','economy','employment','offer','accept'].includes(a.type))return 'trade';
 if(a.type==='construction'||a.type==='buildingMigration'||a.type==='build')return 'construction';if(a.type==='civic'||a.type==='publicDuty')return 'community';
 if(['longCare','health','care'].includes(a.type))return 'care';if(a.type==='education'||a.type==='learn')return 'learning';
 if(a.type==='bury'||a.type==='funerary')return 'funerary';if(a.type==='culture'||a.type==='social'||a.type==='talk')return 'social';
 if(a.type==='ferry')return a.operation==='build'||a.operation==='repair'?'construction':'exploration';if(['move','leave','travelToValley','stayOutside'].includes(a.type))return 'exploration';return 'family';
}
function expiringOpportunity(c:ActionChoice){const a=c.action;return c.id.startsWith('frontier.livestock.')||a.type==='frontierHazard'&&a.operation!=='repair'||a.type==='publicDuty'&&['receive','reschedule','attend','stay','resign'].includes(a.operation)||a.type==='health'&&['treat','receive','cancelRescue'].includes(a.operation)||a.type==='education'&&['teach','study'].includes(a.operation)||a.type==='employment'&&a.operation==='work'||a.type==='longCare'&&a.operation==='visit'||a.type==='ferry'&&['board','depart','disembark'].includes(a.operation);}
function control(c:ActionChoice){const a=c.action;if(['respond','homeReply','familyConsent','separate','accept'].includes(a.type))return true;
 return 'operation' in a&&['respond','approveGift','acceptGift','declineGift','cancelGift','consent','accept','assent','decline','cancel','withdraw','withdrawSponsor','cancelRescue','declineRescue','acceptRescue','receiveHandoff','acceptSupport','declineSupport','reject','cancelOffer','cancelShipment','resign','disarm'].includes(a.operation);
}
/** Bounded overview and optional self-selected focus. Rotation changes visibility, never the resident's action. */
export function focusedChoices(context:DecisionContext,all:ActionChoice[]):ActionChoice[]{
 if(!context.formal||context.formal.passenger||context.formal.aboard)return all;
 const focus=context.actor.agency?.focus,result:ActionChoice[]=[],seen=new Set<ActionChoice>(),limit=56;
 const add=(c:ActionChoice)=>{if(result.length<limit&&!seen.has(c)){result.push(c);seen.add(c);}};
 const group=(choices:ActionChoice[])=>{const groups=new Map<Focus,ActionChoice[]>();for(const c of choices){const d=domain(c),values=groups.get(d)??[];values.push(c);groups.set(d,values);}return [...groups.values()];};
 const rotate=(choices:ActionChoice[],n:number,minutes=30)=>{const offset=Math.floor(context.minute/minutes)%Math.max(1,choices.length);for(let i=0;i<Math.min(n,choices.length);i++)add(choices[(offset+i)%choices.length]);};
 const round=(groups:ActionChoice[][],budget:number)=>{let used=0;for(let i=0;used<budget;i++){let found=false;for(const items of groups){if(i>=items.length)continue;found=true;const before=result.length;const offset=Math.floor(context.minute/30)%items.length;add(items[(offset+i)%items.length]);used+=result.length-before;if(used>=budget||result.length===limit)return;}if(!found)return;}};
 all.filter(expiringOpportunity).forEach(add);
 all.filter(c=>['eat','sleep','wait'].includes(c.action.type)).forEach(add);
 if(context.formal.frontier)for(const op of ['hunt','fish','tameAnimal','shoreRest','feedAnimal','waterAnimal','collectAnimal']){
  all.filter(c=>c.action.type==='industry'&&c.action.operation===op).slice(0,2).forEach(add);
 }
 if(context.formal.frontier){
  const fieldWork=all.find(c=>c.id==='industry.huntingTrail'||c.id==='industry.equip.spear');
  const cookGame=all.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='gameMeal');
  if(fieldWork)add(fieldWork);if(cookGame)add(cookGame);
  const spear=all.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='spear');
  if(spear&&!fieldWork&&!context.actor.inventory.spearKit&&!all.some(c=>c.action.type==='industry'&&c.action.operation==='hunt'))add(spear);
  for(const opportunity of all.filter(c=>c.action.type==='production'&&['collectManure','fertilize'].includes(c.action.operation)).slice(0,2))add(opportunity);
  const compost=all.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='compost');
  if(compost)add(compost);
 }
 if(context.formal.frontier){
  const designs=all.filter(c=>c.action.type==='design');
  designs.filter(c=>c.action.type==='design'&&c.action.operation==='draw').forEach(add);
  rotate(designs.filter(c=>c.action.type==='design'&&c.action.operation!=='draw'),3);
  rotate(all.filter(c=>c.action.type==='construction'&&c.action.definition?.startsWith('building/resident-')),2);
 }
 all.filter(c=>c.action.type==='agency'&&['reflect','conclude','disarm'].includes(c.action.operation)).forEach(add);
 const controls=all.filter(c=>control(c)&&!seen.has(c));if(controls.length<=24)controls.forEach(add);else round(group(controls),24);
 if(focus)rotate(all.filter(c=>domain(c)===focus&&!seen.has(c)&&c.action.type!=='agency'),20);
 const ordinary=all.filter(c=>!seen.has(c)&&(!focus||domain(c)!==focus));if(focus){for(const options of group(ordinary))rotate(options,2);}else round(group(ordinary),limit-result.length);
 return result;
}
