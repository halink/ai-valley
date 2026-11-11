// Synthetic offline experiment observation only. Never imported by production runtime.
// No amount, timing, ecology, or serialized field is changed.
// Call-stack classification is verified only with source .ts modules under Node/tsx.
// Attach binds the current static bush objects; this is not a general dynamic-resource ledger.
// Every amount assignment passes through unchanged; increments and decrements are separate.
export function createBerryObserver(onChange=()=>{}){
 const seen=new WeakSet(),resources={},issues=[];let changes=0;
 const sums=()=>Object.values(resources).reduce((s,r)=>{for(const k of ['opening','regrown','consumed','otherAdded','otherRemoved','amount'])s[k]+=r[k];return s;},{opening:0,regrown:0,consumed:0,otherAdded:0,otherRemoved:0,amount:0});
 function attach(w){for(const resource of w.resources){if(resource.kind!=='bush'||seen.has(resource))continue;seen.add(resource);let amount=resource.amount;
 const r=resources[resource.id]??={opening:amount,regrown:0,consumed:0,otherAdded:0,otherRemoved:0,amount};
 if(r.amount!==amount)issues.push({type:'reload-amount-mismatch',id:resource.id,expected:r.amount,actual:amount,minute:w.minute});
 Object.defineProperty(resource,'amount',{enumerable:true,configurable:true,get(){return amount;},set(next){const prior=amount;amount=next;const delta=next-prior;if(!delta)return;const stack=new Error().stack??'';const source=stack.includes('/world/frontier-wildlife.ts:')?'wildlife':stack.includes('/world/production.ts:')?'production':stack.includes('/world/frontier-hazards.ts:')?'hazard':'other';
 if(delta>0)r[source==='production'?'regrown':'otherAdded']+=delta;else r[source==='wildlife'?'consumed':'otherRemoved']-=delta;r.amount=next;changes++;const event={minute:w.minute,id:resource.id,at:{...resource.at},before:prior,after:next,delta,source};onChange(event);
 if(r.opening+r.regrown+r.otherAdded-r.consumed-r.otherRemoved!==r.amount)issues.push({type:'berry-accounting',...event});
 }});
 }}
 return {attach,snapshot:()=>({totals:sums(),resources,issues,changes,scope:'All initial natural bushes. Wildlife decrements are actual forage consumption; all other increments/removals remain separate. Wildlife species attribution is not inferred from net hunger.'})};
}
