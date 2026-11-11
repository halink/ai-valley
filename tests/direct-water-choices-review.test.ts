import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,DecisionContext} from '../src/shared/types.js';
import type {ActionChoice} from '../src/server/affordances.js';
import {parseChoice} from '../src/server/affordances.js';
import {focusedChoices} from '../src/server/agency-opportunities.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {createWorld} from '../src/world/seed.js';
import {initializeWaterSupply} from '../src/world/water-supply.js';
import {YEAR} from '../src/world/time.js';
const row=(id:string,action:object):ActionChoice=>({id,label:id,action:action as Action});
function context(){const w=createWorld(771);w.mode='formal';w.minute=600;const r=w.residents[0];w.residents=[r];w.resources=[];w.plots=[];w.buildings=[];r.bornAt=w.minute-30*YEAR;r.canDecide=r.canExpress=true;r.inventory={};r.homeId=null;r.inside=null;r.roomAt=null;r.knownBuildings=[];initializeWaterSupply(w);w.waterSupply!.vessels.push({id:'review-own',ownerId:r.id,buildingId:null,capacity:6,amount:3,quality:'safe',createdAt:600});w.waterSupply!.assistance!.push({id:'review-auth',beneficiaryId:r.id,providerId:'synthetic-provider',createdAt:590,expiresAt:2040,limit:2,used:0,revokedAt:null,revokedBy:null});return decisionContext(w,r);}
const drink=row('review.drink',{type:'waterSupply',operation:'drink',vesselId:'review-own',receiptId:'review-receipt'});
const revoke=row('review.revoke',{type:'waterSupply',operation:'revokeAssist',authorizationId:'review-auth',receiptId:'review-receipt'});
function pressure(){const rows:ActionChoice[]=[];const add=(id:string,a:object)=>rows.push(row(id,a));
 add('wait',{type:'wait',minutes:15});add('sleep',{type:'sleep',minutes:15});add('borrowed.sleep',{type:'sleep',buildingId:'bed',minutes:15});add('shore',{type:'industry',operation:'shoreRest'});
 for(const item of ['berry','bread','fish','meat'])add('eat.'+item,{type:'eat',item});
 add('borrow',{type:'commons',operation:'borrowBed'});for(let i=0;i<3;i++)add('visit.'+i,{type:'move',to:{x:i,y:0}});
 for(let i=0;i<2;i++)add('evacuate.'+i,{type:'health',operation:'rescue',targetId:'child'+i,evacuationDangerId:'flood'});
 for(const [type,operation] of [['commons','takeFood'],['commons','inspectFood'],['outsideAid','collect'],['production','emergencyEstateRation'],['economy','retrieve'],['economy','buy'],['gather',''],['publicDuty','receive']])add('food.'+type+operation,{type,operation,item:'berry',resourceId:'bush'});
 for(const operation of ['feedAnimal','waterAnimal'])for(let i=0;i<2;i++)add(operation+i,{type:'industry',operation,animalId:'animal'+i});
 for(const operation of ['verify','stay'])add(operation,{type:'adultPresence',operation});
 for(const operation of ['rescueMeal','feed','offer','review','requestHelp','postHelp','sendHelp','readHelp','visitHelp','withdrawHelp'])add(operation,{type:'emergencyCare',operation,childId:'child'});
 for(let i=0;i<2;i++)add('custody'+i,{type:'production',operation:'custodyOffer',childId:'child'+i});
 for(const operation of ['acceptRescue','declineRescue','cancelRescue'])add(operation,{type:'health',operation,offerId:'rescue'});
 for(const operation of ['approveHandoff','declineHandoff'])add(operation,{type:'longCare',operation,replacementId:'handoff'});
 for(const operation of ['declare','read'])add('wish.'+operation,{type:'lastWish',operation,wishId:'wish'});
 for(let i=0;i<20;i++)add('work'+i,{type:'employment',operation:'work',contractId:'work'+i});
 return rows;
}
function stressed(){const c=context();c.actor.hunger=90;c.resources=[{id:'bush',kind:'bush',at:{x:0,y:0},amount:10} as DecisionContext['resources'][number]];return c;}
test('independent review: frozen candidate identities survive once-only direct-drink selection and hard budget',()=>{
 const c=stressed(),all=[...pressure(),drink];const snapshot=structuredClone(all);for(const x of all){Object.freeze(x.action);Object.freeze(x);}Object.freeze(all);
 for(let i=0;i<40;i++){c.minute=i*30;const selected=focusedChoices(c,all);assert.ok(selected.includes(drink));assert.ok(selected.length<=56);assert.equal(new Set(selected).size,selected.length);}assert.deepEqual(all,snapshot);
});
test('independent review: adding self drinking does not remove an otherwise visible live water withdrawal',()=>{
 const c=stressed(),all=[...pressure(),revoke];const before=focusedChoices(c,all),after=focusedChoices(c,[...all,drink]);assert.equal(before.length,56);assert.ok(before.includes(revoke),'baseline must expose the actual withdrawal');assert.ok(after.includes(drink));assert.ok(after.includes(revoke),'self drinking must not displace a live permission withdrawal');
});
test('independent review: actual numbered menu retains the live withdrawal beside direct drinking',()=>{
 const c=stressed();const legalRevoke=c.formal!.opportunities.find(x=>x.action.type==='waterSupply'&&x.action.operation==='revokeAssist')!,legalDrink=c.formal!.opportunities.find(x=>x.action.type==='waterSupply'&&x.action.operation==='drink')!;assert.ok(legalRevoke);assert.ok(legalDrink);
 // Search ordinary pressure sizes instead of relying on a particular base-menu width.
 let witnessed=false;
 for(let count=0;count<=20;count++){
  const base=pressure().filter(x=>!x.id.startsWith('work')||Number(x.id.slice(4))<count);
  c.formal!.opportunities=[...base,legalRevoke];const before=decisionChoices(c);
  c.formal!.opportunities=[...base,legalRevoke,legalDrink];const after=decisionChoices(c);
  const stop=(x:ActionChoice)=>x.action.type==='waterSupply'&&x.action.operation==='revokeAssist';
  if(before.some(stop)&&!after.some(stop)){witnessed=true;assert.fail(`numbered menu loses water withdrawal at work count ${count}; before=${before.length}, after=${after.length}, selected drink=${after.find(x=>x.action.type==='waterSupply'&&x.action.operation==='drink')?.id}`);}
  for(const x of after)if(x.action.type==='waterSupply'&&x.action.operation==='drink')assert.deepEqual(parseChoice(JSON.stringify({choice:x.id}),after).actions,[x.action]);
 }
 assert.equal(witnessed,false);
});

const protectedExamples:ActionChoice[]=[
 ...['revokeAssist','declineVessel','cancelVessel','acceptVessel'].map(operation=>row('water.'+operation,{type:'waterSupply',operation,receiptId:'review',authorizationId:'auth',giftId:'gift'})),
 row('land.no',{type:'landRights',operation:'vote',applicationId:'land',approve:false}),
 row('region.no',{type:'regionSurvey',operation:'vote',surveyId:'region',approve:false}),
 row('land.object',{type:'landRights',operation:'object',applicationId:'land'}),
 row('wish.no',{type:'lastWish',operation:'refuseGift',wishId:'wish'}),
 row('gift.reject',{type:'foreignTrade',operation:'reject',offerId:'offer'}),
 row('family.stop',{type:'familyRelocation',operation:'withdraw',agreementId:'family'}),
 row('child.stop',{type:'respond',proposalId:'care',accept:false}),
 row('food.take',{type:'commons',operation:'takeFood',buildingId:'hall',item:'berry'}),
 row('food.buy',{type:'economy',operation:'buy',item:'berry'}),
 row('food.reserve',{type:'publicDuty',operation:'receive'}),
 row('food.harvest',{type:'industry',operation:'harvestFruit',treeId:'fruit'}),
 row('food.foreign',{type:'foreignTrade',operation:'collect',shipmentId:'shipment'}),
 row('meal.help',{type:'emergencyCare',operation:'rescueMeal',childId:'child'}),
 row('evacuate',{type:'health',operation:'rescue',targetId:'child',evacuationDangerId:'flood'}),
 row('ferry.out',{type:'ferry',operation:'disembark',ferryId:'boat'}),
 row('rest',{type:'sleep',minutes:120}),
];
function exactSafetyRows(n:number){return [...protectedExamples,...Array.from({length:n-protectedExamples.length},(_,i)=>row('stop.'+i,{type:'agency',operation:'disarm',routineId:'routine'+i}))];}
test('independent review: mixed food, rescue, voting and withdrawal menus cannot lose any selected row to water',()=>{
 const c=stressed();for(let t=0;t<24;t++){c.minute=t*30;const rows=exactSafetyRows(56),before=focusedChoices(c,rows),after=focusedChoices(c,[...rows,drink]);assert.equal(before.length,56);assert.deepEqual(after,before);}
});
test('independent review: exactly one ordinary job can pay for water without removing 55 mixed safety rows',()=>{
 const c=stressed(),safe=exactSafetyRows(55),job=row('ordinary.job',{type:'employment',operation:'work',contractId:'ordinary'});
 for(let t=0;t<24;t++){c.minute=t*30;const rows=focusedChoices(c,[...safe,job,drink]);assert.equal(rows.length,56);for(const x of safe)assert.ok(rows.includes(x),x.id);assert.ok(rows.includes(drink));assert.ok(!rows.includes(job));}
});
test('independent review: two ordinary supply rows are separate from the protected water control budget',()=>{
 const c=stressed(),controls=protectedExamples.slice(0,4),water=[drink,...Array.from({length:7},(_,i)=>row('drink.extra.'+i,{type:'waterSupply',operation:'drink',vesselId:'extra'+i,receiptId:'review'}))];
 for(let t=0;t<24;t++){c.minute=t*30;const rows=focusedChoices(c,[...controls,...water]);assert.equal(rows.length,6);for(const x of controls)assert.ok(rows.includes(x));assert.equal(rows.filter(x=>x.action.type==='waterSupply'&&x.action.operation==='drink').length,2);assert.equal(new Set(rows).size,rows.length);}
});

test('independent review: two originally selected water-care choices keep both supply slots even with free ordinary space',()=>{
 const c=stressed();c.minute=0;
 const care=['authorizeAssist','assistDrink','serveChild'].map(operation=>row('supply.care.'+operation,{type:'waterSupply',operation,receiptId:'care-receipt',targetId:'recipient',authorizationId:'authorization',vesselId:'care-vessel'}));
 for(let i=0;i<care.length;i++)for(let j=i+1;j<care.length;j++){
  const rows=focusedChoices(c,[care[i],care[j],drink]);assert.equal(rows.length,2);assert.ok(rows.includes(care[i]),care[i].id);assert.ok(rows.includes(care[j]),care[j].id);assert.ok(!rows.includes(drink));
 }
});
test('independent review: a sole remaining supply slot cannot be taken from an originally visible assisted drink',()=>{
 const c=stressed();c.minute=0;const safety=Array.from({length:55},(_,i)=>row('safe.stop.'+i,{type:'agency',operation:'disarm',routineId:'r'+i}));
 const aid=row('care.assist',{type:'waterSupply',operation:'assistDrink',receiptId:'receipt',authorizationId:'auth',vesselId:'vessel'});
 const rows=focusedChoices(c,[...safety,aid,drink]);assert.equal(rows.length,56);for(const x of [...safety,aid])assert.ok(rows.includes(x),x.id);assert.ok(!rows.includes(drink));
});

test('independent review: original two-slot phase is unchanged without drinking and selected care survives every phase with drinking',()=>{
 const c=stressed(),water=['authorizeAssist','load','assistDrink','decant','serveChild','boil'].map(operation=>row('phase.'+operation,{type:'waterSupply',operation,receiptId:'phase',vesselId:'v',authorizationId:'a',targetId:'p',buildingId:'hall',quantity:1}));
 for(const candidates of [water,[...water,drink]])for(let t=0;t<42;t++){
  c.minute=t*30;const original=[candidates[t%candidates.length],candidates[(t+1)%candidates.length]],rows=focusedChoices(c,candidates);
  assert.ok(rows.length<=2);assert.equal(new Set(rows).size,rows.length);
  if(candidates===water)assert.deepEqual(rows,original);
  for(const x of original)if(x.action.type==='waterSupply'&&['authorizeAssist','assistDrink','serveChild'].includes(x.action.operation))assert.ok(rows.includes(x),`${t}: ${x.id}`);
 }
});
