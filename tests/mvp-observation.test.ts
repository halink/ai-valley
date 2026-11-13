import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mvpObservation} from '../src/server/mvp-observation.js';
import {createMvpWorld,createMvpSession} from '../src/server/godot-mvp.js';
test('observation projects independent pause, requests, cooldown facts without raw failure or configuration',()=>{
 const world=createMvpWorld();world.clock.paused=true;world.metrics.configured=true;world.metrics.lastError='secret-key-invalid';
 const result=mvpObservation(world,['a','a','b'],[900,1200,1300],false,1000);
 assert.deepEqual(result,{observedAt:1000,paused:true,model:{configured:true,requestActorIds:['a','b'],requestCount:2,cooldownProviders:2,cooldownRemainingMs:300,lastFailure:'other_failure'}});
 assert.ok(!JSON.stringify(result).includes('secret'));
 world.metrics.lastError='model_http_429';assert.equal(mvpObservation(world,[],[],false,1000).model.lastFailure,'http_429');
 assert.equal(mvpObservation(world,[],[],true,1000).model.lastFailure,'unresolved_request');
 world.metrics.lastError=null;assert.equal(mvpObservation(world,[],[],false,1400).model.lastFailure,null);
 assert.equal(mvpObservation(world,[],[1300],false,1400).model.cooldownRemainingMs,0);
});
test('rule snapshot declares no model requests or cooldown, including fresh worlds',()=>{
 for(let i=0;i<2;i++){
  const result=createMvpSession().snapshot().observation;
  assert.deepEqual(result.model,{configured:false,requestActorIds:[],requestCount:0,cooldownProviders:0,cooldownRemainingMs:0,lastFailure:null});
 }
});
