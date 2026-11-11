import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionChoices,decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {buildChoices,parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {focusNames} from '../src/shared/agency.js';
import {GLM_MODEL} from '../src/server/model-completion.js';

const tones=['friendly','hostile','neutral'];
function fixture(){const w=createFrontierWorld(5401);w.clock.paused=false;stepWorld(w,1);assert.equal(w.minute,481);return {w,r:w.residents[0],peer:w.residents[1]};}
function groups(menu:ActionChoice[]){const out=new Map<string,string[]>();for(const {action:a} of menu)if(a.type==='talk'){const list=out.get(a.targetId)??[];list.push(a.tone);out.set(a.targetId,list);}return out;}
function complete(menu:ActionChoice[]){const g=groups(menu);assert.ok(g.size<=3,'at most three complete target groups');for(const [id,t] of g)assert.deepEqual(t.sort(),tones,id);return g;}

test('independent social review: formal minute 481 spouse receives all tones, with no world mutation',()=>{
 const {w,r,peer}=fixture(),before=structuredClone(w),c=decisionContext(w,r),contextBefore=structuredClone(c);
 assert.deepEqual(complete(buildChoices(c)).get(peer.id),tones);
 const p=prepareModelDecision(c,undefined,GLM_MODEL);assert.deepEqual(complete(p.choices).get(peer.id),tones);
 assert.deepEqual(w,before);assert.deepEqual(c,contextBefore);
 for(const tone of tones){const row=p.choices.find(c=>c.action.type==='talk'&&c.action.targetId===peer.id&&c.action.tone===tone)!;assert.match(row.id,/^\d+$/);assert.ok(p.messages.some(m=>m.content.includes(row.id+'. '+row.label)));const a=parseChoice(JSON.stringify({choice:row.id,text:'我有自己的看法。'}),p.choices).actions[0];assert.equal(a.type,'talk');if(a.type==='talk'){assert.equal(a.tone,tone);assert.equal(a.targetId,peer.id);assert.equal(a.text,'我有自己的看法。');assert.equal(a.observedTarget?.atMinute,481);}}
 assert.deepEqual(w,before);
});

test('independent social review: all focus choices retain complete groups under saturation and clock rotation',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);
 for(let i=0;i<160;i++)c.formal!.opportunities.push({id:`social-review.work.${i}`,label:'Synthetic appointment',action:{type:'employment',operation:'work',contractId:`review-${i}`}});
 c.formal!.opportunities.push({id:'care.stop.social-review',label:'Stop current care',action:{type:'health',operation:'cancelRescue',transportId:'review'}});
 for(const focus of Object.keys(focusNames) as Array<keyof typeof focusNames>){c.actor.agency={focus,goals:[],routines:[],nextSerial:1};for(let i=0;i<12;i++){c.minute=480+i*30;const before=structuredClone(c),menu=decisionChoices(c);assert.ok(complete(menu).size>0);assert.ok(menu.length<=69,'59 existing ordinary budget + 9 social rows + one stop');assert.ok(menu.some(c=>c.label==='Stop current care'));assert.equal(new Set(menu.map(c=>c.id)).size,menu.length);assert.deepEqual(c,before);}}
});

test('independent social review: nearest target stays and remaining visible known targets rotate fairly',()=>{
 const {w,r,peer}=fixture();for(const p of w.residents){p.inside=null;p.roomAt=null;p.at={...r.at};p.knownPeople=w.residents.filter(q=>q.id!==p.id).map(q=>q.id);}peer.at={...r.at};
 // IDs resolve equal-distance ties deterministically, independently of people array order.
 const c=decisionContext(w,r),nearest=[...c.people].sort((a,b)=>a.id.localeCompare(b.id))[0].id,seen=new Set<string>();
 for(let i=0;i<16;i++){c.minute=480+i*30;const basic=complete(buildChoices(c)),final=complete(decisionChoices(c));assert.equal(final.size,3);assert.ok(final.has(nearest));assert.deepEqual([...final.keys()].sort(),[...basic.keys()].sort());for(const id of final.keys())seen.add(id);const reordered={...c,people:[...c.people].reverse()};assert.deepEqual([...groups(decisionChoices(reordered)).keys()].sort(),[...final.keys()].sort());}
 assert.deepEqual([...seen].sort(),c.people.map(p=>p.id).sort());
});

test('independent social review: expression-only, passenger, travel, and nonexpressive actor restrictions survive restoration',()=>{
 const {w,r}=fixture();for(const flag of ['careWithdrawalOnly','expressiveEvacuationOnly','familyTravelling','passenger'] as const){const c=decisionContext(w,r);c.formal![flag]=true;assert.equal(groups(buildChoices(c)).size,0,flag);assert.equal(groups(decisionChoices(c)).size,0,flag);}
 r.canExpress=false;assert.equal(groups(decisionChoices(decisionContext(w,r))).size,0);
});

test('independent social review: absent, dead, and unobserved people are never resurrected as talk targets',()=>{
 for(const kind of ['wall','dead','outside','unknown'] as const){const {w,r,peer}=fixture();if(kind==='wall')peer.inside=peer.homeId;else if(kind==='dead')peer.status='dead';else if(kind==='outside')peer.residency='outside';else r.knownPeople=r.knownPeople.filter(id=>id!==peer.id);const c=decisionContext(w,r);for(let i=0;i<12;i++){c.minute=480+i*30;assert.ok(!groups(decisionChoices(c)).has(peer.id),kind);}}
});


test('independent social review: explicit hostile speech records only chosen words, not automatic relationship scores',()=>{
 const {w,r,peer}=fixture();r.at={...peer.at};const c=decisionContext(w,r),menu=decisionChoices(c),row=menu.find(c=>c.action.type==='talk'&&c.action.targetId===peer.id&&c.action.tone==='hostile');assert.ok(row);
 const score=()=>[r,peer].map((p,i)=>{const relation=p.relations.find(q=>q.targetId===(i===0?peer.id:r.id));return relation?{affection:relation.affection,trust:relation.trust,conflict:relation.conflict}:null;});
 const before=score(),text='我不同意这件事，请听我说。',a=parseChoice(JSON.stringify({choice:row.id,text}),menu).actions[0];
 assert.equal(w.events.some(e=>e.kind==='conversation'&&e.text.includes(text)),false);
 const result=submitPlan(w,{id:'review-explicit-hostile',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Explicit offline speech selection',actions:[a]});assert.equal(result.ok,true);
 let budget=120;while(r.plan||r.activity){assert.ok(budget--);stepWorld(w,1);}
 assert.equal(r.lastFailure,null);assert.ok(w.events.some(e=>e.kind==='conversation'&&e.text===r.name+'：'+text));assert.deepEqual(score(),before);assert.equal(w.metrics.requests,0);
});

test('independent social review: restoration preserves every saturated non-reflection action and one goal revision',async()=>{
 const {restoreSocialToneChoices}=await import('../src/server/social-tone-choices.js');const {w,r}=fixture(),c=decisionContext(w,r);
 const rows:ActionChoice[]=Array.from({length:59},(_,i)=>({id:`review.move.${i}`,label:'Existing independent move',action:{type:'move',to:{x:i,y:1}}}));
 rows[1]={id:'review.refusal',label:'Refuse pending proposal',action:{type:'respond',proposalId:'review',accept:false}};
 rows[2]={id:'review.emergency',label:'Emergency ration',action:{type:'production',operation:'emergencyEstateRation'}};
 rows[3]={id:'review.stop',label:'Stop care',action:{type:'health',operation:'cancelRescue',transportId:'review'}};
 rows[4]={id:'review.reflect.1',label:'Revise own goal',action:{type:'agency',operation:'reflect',focus:'daily',text:'My choice'}};
 rows[5]={id:'review.reflect.2',label:'Revise own goal',action:{type:'agency',operation:'reflect',focus:'care',text:'My choice'}};
 const before=structuredClone(rows),after=restoreSocialToneChoices(c,rows);assert.deepEqual(rows,before);assert.ok(after.length<=68);assert.equal(after.filter(c=>c.action.type==='agency'&&c.action.operation==='reflect').length,1);for(const row of rows.filter(c=>c.action.type!=='agency'))assert.ok(after.includes(row));complete(after);assert.deepEqual(restoreSocialToneChoices(c,after),after);
});

test('independent social review: a full 32-row intermediate vocabulary cannot truncate final target tones',()=>{
 const {w,r}=fixture();for(const p of w.residents.slice(1,4)){p.at={...r.at};p.inside=null;p.roomAt=null;r.knownPeople.push(p.id);}const c=decisionContext(w,r);c.formal!.opportunities=[];c.people=c.people.map(p=>({...p,talkEligible:true}));c.formal!.productiveFarming=false;c.formal!.hasBed=true;c.season='spring';
 c.actor.inventory={seed:3,turnip:3,water:3,meal:3,berry:3,fish:3};
 c.buildings=c.buildings.map(b=>({...b,door:{x:b.door.x+1,y:b.door.y},observed:undefined}));c.buildings.push({...c.buildings.find(b=>b.ownerId==='commons')!,id:'review.commons',door:{x:r.at.x+2,y:r.at.y}});
 c.resources=['tree','rock'].map((kind,i)=>({id:'review.resource.'+i,kind:kind as 'tree'|'rock',at:{...r.at},amount:10,max:10,regrowthDays:1,lastHarvest:0}));
 c.plots=[0,1,2].map(i=>({id:'review.plot.'+i,ownerId:r.id,at:{...r.at},crop:i===0?null:{definition:'crop/turnip@1',planted:0,growth:i===1?1:5,wateredDay:-1,lastGrowthDay:-1}}));
 c.offers=c.people.slice(0,2).map((p,i)=>({id:'review.offer.'+i,actorId:p.id,targetId:r.id,give:{turnip:1},want:{water:1},expiresAt:c.minute+100,status:'open',definition:'trade/barter@1'}));
 const basic=buildChoices(c);assert.equal(basic.length,32,JSON.stringify(basic.map(c=>c.id)));assert.ok([...groups(basic).values()].some(v=>v.length<3),'the fixture actually exercises a cut group');const menu=decisionChoices(c);assert.equal(complete(menu).size,3);for(const row of basic.filter(row=>row.action.type!=='talk'))assert.ok(menu.some(c=>c.label===row.label),'existing basic non-talk choice survives');
});

test('independent social review: nearest indoor person is chosen by observed room position, not shared doorway',()=>{
 const {w,r}=fixture(),near=w.residents.at(-1)!,home=w.buildings.find(b=>b.id===r.homeId)!;home.residents=w.residents.map(p=>p.id);for(const p of w.residents){p.inside=home.id;p.at={...home.door};p.roomAt={x:8,y:9};p.knownPeople=w.residents.filter(q=>q.id!==p.id).map(q=>q.id);}r.roomAt={x:4,y:9};near.roomAt={x:5,y:9};const c=decisionContext(w,r);assert.ok(c.people.some(p=>p.id===near.id));
 for(let i=0;i<16;i++){c.minute=480+i*30;assert.ok(complete(decisionChoices(c)).has(near.id),'actual nearest indoor person stays across rotations');}
});
