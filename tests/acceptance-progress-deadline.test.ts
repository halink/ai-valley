import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AcceptanceStopControl,type AcceptanceStopOptions} from '../src/server/acceptance-stop-control.js';
import {DEEPSEEK_MODEL} from '../src/server/model-completion.js';
function fixture(extra:Partial<AcceptanceStopOptions>={}){
 let now=100,stops=0,timer:(()=>void)|undefined,delay:number|undefined;
 const options:AcceptanceStopOptions={endGameMinute:100,maxWallMs:1000,maxRequests:5,allowedModels:[DEEPSEEK_MODEL],
  assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:5000}),
  clock:{now:()=>now,setTimer:(fn,ms)=>{timer=fn;delay=ms;return 1;},clearTimer:()=>{timer=undefined;}},...extra};
 const control=new AcceptanceStopControl(options,()=>{stops++;});
 return {control,get delay(){return delay;},get stops(){return stops;},setNow:(value:number)=>{now=value;},fire:()=>timer?.()};
}
test('earlier absolute monotonic bound determines timer and synchronously blocks progress',()=>{
 const f=fixture({deadlineMonotonicMs:300});f.control.start(0);assert.equal(f.delay,200);
 f.setNow(300);assert.equal(f.control.clampAdvance(0,10),0);assert.equal(f.control.status().reason,'wall_limit');assert.equal(f.stops,1);
});
test('later absolute bound cannot extend elapsed wall budget; timer fires without requests',()=>{
 const f=fixture({deadlineMonotonicMs:5000});f.control.start(0);assert.equal(f.delay,1000);
 f.setNow(1100);f.fire();assert.equal(f.control.status().phase,'stopped');assert.equal(f.control.status().reason,'wall_limit');
});
test('progress price check rejects expiry without reservation or request',()=>{
 let valid=true;const f=fixture({revalidatePriceOnProgress:true,assessPrice:model=>valid?{model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:5000}:null});
 f.control.start(0);valid=false;assert.equal(f.control.check(0),false);assert.equal(f.control.status().reason,'cost_unknown');
 assert.equal(f.control.status().requestReservations,0);
});
test('price assessment synchronous delay cannot overrun absolute bound',()=>{
 let slow=()=>{};const f=fixture({deadlineMonotonicMs:300,revalidatePriceOnProgress:true,assessPrice:model=>{slow();return {model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:5000};}});
 f.control.start(0);slow=()=>f.setNow(301);assert.equal(f.control.check(0),false);assert.equal(f.control.status().reason,'wall_limit');
});
for(const deadline of [NaN,Infinity,-1])test(`invalid absolute deadline ${deadline} is rejected`,()=>{
 assert.throws(()=>fixture({deadlineMonotonicMs:deadline}),/invalid_acceptance_stop_options/);
});
