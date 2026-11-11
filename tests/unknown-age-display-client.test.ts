import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {YEAR} from '../src/world/time.js';
import type {Resident,Snapshot} from '../src/shared/types.js';
import type {Biography} from '../src/shared/history.js';
import * as renderers from '../src/client/panel-renderers.js';
import {censusPanel} from '../src/client/community.js';
import {biographyOverview} from '../src/client/history.js';
import {clientMainHarness} from './helpers/client-main.js';

const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(bornAt:unknown,minute=1000.25):Snapshot{
 const world=createWorld();world.minute=minute;world.residents=world.residents.slice(0,1);
 Object.assign(world.residents[0],{bornAt,status:'alive',residency:'resident',deathAt:null});
 return {world,mapRevision:'test-map',version:'test',serverTime:'test',capabilities:{active:[],pending:[]}};
}
const invalidBirths=[undefined,null,NaN,Infinity,-Infinity,'0',1001,Number.MAX_SAFE_INTEGER+1];

test('real selection, people list and profile render unknown dates explicitly without mutating them',async()=>{
 for(const bornAt of invalidBirths){
  const snapshot=fixture(bornAt),before=structuredClone(snapshot),person=snapshot.world.residents[0];
  const app=await clientMainHarness(snapshot,async()=>renderers);
  app.click({follow:person.id});
  assert.match(app.el('selection').innerHTML,/年龄未知/);
  assert.doesNotMatch(app.el('selection').innerHTML,/\b(?:0|NaN|Infinity) 岁/);
  app.click({panel:'people'});
  assert.match(app.el('panel-body').innerHTML,/<small>年龄未知<\/small>/);
  app.click({person:person.id});await settle();
  assert.match(app.el('panel-body').innerHTML,/<p>年龄未知 · 山谷居民<\/p>/);
  assert.deepEqual(snapshot,before);app.escape();
 }
});

test('real age labels preserve zero, fractional birthday boundaries and age at death',async()=>{
 const bornAt=-YEAR*18+.3,birthday=bornAt+18*YEAR;
 for(const sample of [
  {bornAt:1000.25,minute:1000.25,label:'0'},
  {bornAt,minute:birthday-0.000000001,label:'17'},
  {bornAt,minute:birthday,label:'18'},
  {bornAt:0,minute:66*YEAR,label:'66',deathAt:64*YEAR},
 ]){
  const snapshot=fixture(sample.bornAt,sample.minute),person=snapshot.world.residents[0];
  if(sample.deathAt!==undefined){person.status='dead';person.deathAt=sample.deathAt;}
  const app=await clientMainHarness(snapshot,async()=>renderers);
  app.click({follow:person.id});assert.match(app.el('selection').innerHTML,new RegExp(` · ${sample.label} 岁`));
  if(sample.deathAt===undefined){app.click({panel:'people'});assert.match(app.el('panel-body').innerHTML,new RegExp(`<small>${sample.label} 岁</small>`));}
  app.click({person:person.id});await settle();
  assert.match(app.el('panel-body').innerHTML,new RegExp(`<p>${sample.deathAt===undefined?sample.label:'64'} 岁 · `));
  assert.doesNotMatch(app.el('panel-body').innerHTML,/年龄未知/);app.escape();
 }
});

test('population counts unknown ages separately, excludes visitors/departed/dead and handles legacy missing book',async()=>{
 const snapshot=fixture(0),w=snapshot.world,base=w.residents[0],minute=w.minute;
 const resident=(id:string,bornAt:unknown,extra:Partial<Resident>={}):Resident=>Object.assign(structuredClone(base),{id,bornAt},extra);
 w.residents=[resident('infant',minute),resident('before18',minute-18*YEAR+.25),resident('adult',minute-18*YEAR),
  resident('before65',minute-65*YEAR+.25),resident('elder',minute-65*YEAR),...invalidBirths.map((birth,i)=>resident(`unknown${i}`,birth)),
  resident('visitor',null,{residency:'visitor'}),resident('outside',null,{residency:'outside'}),resident('dead',null,{status:'dead'})];
 delete w.population;
 const before=structuredClone(w),html=censusPanel(w);
 assert.match(html,/未满 18 岁 2 人 · 65 岁及以上 1 人 · 年龄未知 8 人/);
 assert.deepEqual(w,before);
 const app=await clientMainHarness(snapshot,async()=>renderers);app.click({panel:'population'});
 assert.equal(app.el('panel-body').innerHTML,html);app.escape();
});

test('biography birth registration rejects unknown/future timestamps and keeps valid pre-opening dates',()=>{
 for(const bornAt of [...invalidBirths,0,-YEAR*20]){
  const w=fixture(bornAt).world,r=w.residents[0];
  const biography:Biography={worldId:w.id,person:{...r,adoptiveParents:[],guardianIds:[]},recordCount:0,
   firstRecordAt:null,lastRecordAt:null,partners:[],history:{worldId:w.id,events:[],hasMore:false,nextCursor:null}};
  const before=structuredClone(biography),html=biographyOverview(biography,w,false,null);
  if(invalidBirths.includes(bornAt))assert.match(html,/登记出生未知（年龄未知）/);
  else {assert.doesNotMatch(html,/年龄未知/);assert.match(html,bornAt===0?/第 1 年/:/开局前约20年（登记资料）/);}
  assert.deepEqual(biography,before);
 }
});
