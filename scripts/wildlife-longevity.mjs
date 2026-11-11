// Read-only source / synthetic world verification. No model, provider, real save, or network.
// From repo root: env -i "$(command -v node)" --import ./scripts/acceptance-offline-guard.mjs --import ./node_modules/tsx/dist/loader.mjs /path/to/this.mjs --seeds 5401,5402,7777 --days 336 --output /absolute/NEW/directory
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length)throw Error('offline_guard_and_empty_environment_required');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert.ok(['--seeds','--days','--output','--wall-seconds'].includes(args[i])&&args[i+1]&&!Object.hasOwn(options,args[i]),'invalid or duplicate argument');options[args[i]]=args[i+1];}
const seeds=(options['--seeds']??'5401,5402,7777').split(',').map(Number),days=Number(options['--days']??336),wallSeconds=Number(options['--wall-seconds']??1800),output=options['--output'];
assert.ok(seeds.length>0&&seeds.length<=10&&new Set(seeds).size===seeds.length&&seeds.every(n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647));
assert.ok(Number.isSafeInteger(days)&&days>=1&&days<=1120);assert.ok(Number.isSafeInteger(wallSeconds)&&wallSeconds>=1&&wallSeconds<=7200);
assert.ok(output&&isAbsolute(output)&&!output.includes('\0'),'new absolute output required');mkdirSync(output,{mode:0o700});
const root=process.cwd(),sourceFiles=['src/shared/frontier-hazards.ts','src/world/fishing.ts','src/world/frontier-wildlife.ts'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(p=>[p,createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')]));
const initialSources=sourceHashes();
const imp=p=>import(pathToFileURL(resolve(root,p)).href);
const [{createFrontierWorld},{stepWorld},{WorldStore},{calendar,DAY,YEAR}]=await Promise.all([imp('src/world/formal-seed.ts'),imp('src/world/engine.ts'),imp('src/server/store.ts'),imp('src/world/time.ts')]);
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(x))))).digest('hex');
const persistedState=w=>{const {events,processed,...other}=w;return other};
const species=['boar','wolf','deer','hare','fox','duck'];
const inc=(o,k,n=1)=>o[k]=(o[k]??0)+n;
const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
function fishState(w){const all={amount:0,opening:0,born:0,caught:0,eaten:0,arrived:0,departed:0},bySpecies={},errors=[];for(const [key,p]of Object.entries(w.industry.fishing)){let sum=0;for(const [kind,s]of Object.entries(p.species??{})){const balance=s.opening+s.born+s.arrived-s.departed-s.caught-s.eaten;if(balance!==s.amount||s.amount<0)errors.push({key,kind,balance,amount:s.amount});sum+=s.amount;const row=bySpecies[kind]??={amount:0,opening:0,born:0,caught:0,eaten:0,arrived:0,departed:0};for(const field of Object.keys(all)){all[field]+=s[field];row[field]+=s[field];}}if(sum!==p.amount)errors.push({key,speciesSum:sum,pool:p.amount});}return {all,bySpecies,errors};}
function ecologyChecks(w){const s=w.frontierHazards,issues=[];for(const [kind,p]of Object.entries(s.wildlifePopulation.species)){const members=s.beasts.filter(b=>b.species===kind&&b.status==='alive'),expected=p.registered+p.born-p.deaths-p.tamed,reserved=members.length+members.filter(b=>b.pregnancy).length;if(expected!==members.length||reserved>p.capacity)issues.push({kind,expected,live:members.length,reserved,capacity:p.capacity});}for(const h of s.predatorEcology.habitats){const members=s.beasts.filter(b=>b.status==='alive'&&b.habitatId===h.id),expected=h.registered+h.born+h.arrived-h.departed-h.deaths,reserved=members.length+members.filter(b=>b.pregnancy).length+s.beasts.filter(b=>b.status==='alive'&&b.migration?.toId===h.id&&b.habitatId!==h.id).length;if(expected!==members.length||reserved>h.capacity)issues.push({habitat:h.id,expected,live:members.length,reserved,capacity:h.capacity});}return issues;}
function scanFinite(x,path='',issues=[]){if(typeof x==='number'&&!Number.isFinite(x))issues.push(path);else if(x&&typeof x==='object')for(const k in x)scanFinite(x[k],path+'.'+k,issues);return issues;}
const allResults=[];
for(const seed of seeds){
 const dir=resolve(output,'seed-'+seed);mkdirSync(dir,{mode:0o700});const journal=resolve(dir,'daily.jsonl'),eventsFile=resolve(dir,'ecology-events.jsonl'),feedFile=resolve(dir,'duck-feeding.jsonl');
 const log=x=>{const s=JSON.stringify(x);appendFileSync(journal,s+'\n');console.log(s);};
 let w=createFrontierWorld(seed),store=new WorldStore(resolve(dir,'world.sqlite')),committed=null;
 store.commit(w,null);committed=w.revision;w.clock.paused=false;
 const from=w.minute,end=from+days*DAY,start=performance.now(),initialWorldHash=hash(w),births=[],deaths=[],extinctions=[],recoveries=[],registry=new Map(),priorCounts={},perAnimal={},pursuits={started:0,ended:0,attacks:0,kills:0,bites:0,endReasons:{}},duck={seedMeals:0,seedNutritionRelief:0,fishMealEvents:0,fishMealIds:[]},patchAccounting={};
 let ticks=0,reloads=0,nextReport=from+DAY,lastEventCount=0,chunkMs=[],lastCheckpointTime=start;
 const observedIssues=[],timings=[];
 function observeIndividuals(prior=[]){for(const b of new Map([...prior,...w.frontierHazards.beasts].map(b=>[b.id,b])).values()){let seen=registry.get(b.id);if(!seen){seen={id:b.id,species:b.species,bornAt:b.bornAt,firstSeenAt:w.minute,initial:w.minute===from,motherId:b.motherId,sireId:b.sireId,status:b.status};registry.set(b.id,seen);if(w.minute!==from)births.push({...seen});}if(b.status==='dead'&&seen.status!=='dead'){deaths.push({id:b.id,species:b.species,at:b.deathAt,cause:b.deathCause,bornAt:b.bornAt,motherId:b.motherId,sireId:b.sireId,hunger:b.hunger,thirst:b.thirst,atPosition:{...b.at}});seen.status='dead';}}for(const kind of species){const n=w.frontierHazards.beasts.filter(b=>b.species===kind&&b.status==='alive').length;if(priorCounts[kind]>0&&!n)extinctions.push({species:kind,at:w.minute,elapsedDays:(w.minute-from)/DAY});if(priorCounts[kind]===0&&n)recoveries.push({species:kind,at:w.minute,count:n});priorCounts[kind]=n;}}
 observeIndividuals();
 const sample=type=>({type,seed,minute:w.minute,elapsedDays:(w.minute-from)/DAY,wallSeconds:(performance.now()-start)/1000,realModelExecuted:false,residents:w.residents.filter(r=>r.status==='alive').length,livestock:w.industry.animals.filter(a=>a.status==='alive').length,liveSpecies:Object.fromEntries(species.map(k=>[k,w.frontierHazards.beasts.filter(b=>b.species===k&&b.status==='alive').length])),birthsBySpecies:births.reduce((m,b)=>(inc(m,b.species),m),{}),deathsBySpeciesCause:deaths.reduce((m,b)=>(inc(m,b.species+':'+b.cause),m),{}),extinctions,recoveries,fish:fishState(w),foodPatches:w.frontierHazards.foodPatches.map(p=>({...p})),patchAccounting,duck,pursuits,wildlifePopulation:w.frontierHazards.wildlifePopulation,predatorEcology:w.frontierHazards.predatorEcology,issues:observedIssues,reloads,ticks,rssMB:process.memoryUsage().rss/1048576,sourceUnchanged:hash(sourceHashes())===hash(initialSources)});
 log({type:'config',seed,days,fromMinute:from,initialWorldHash,sourceHashes:initialSources,node:process.version,platform:process.platform,arch:process.arch,stepMinutes:1,loop:'complete stepWorld',reloadMode:'daily SQLite handle close/reopen + loadForRuntime in same Node process',decisions:'none; manually unpaused synthetic world',emptyEnvironment:true,offlineGuard:true,map:[w.map.width,w.map.height],resources:w.resources.length,initialIndividuals:[...registry.values()]});
 try{
  while(w.minute<end&&(performance.now()-start)<wallSeconds*1000){
   const priorIndividuals=w.frontierHazards.beasts.slice();
   const old=new Map(w.frontierHazards.beasts.filter(b=>b.status==='alive').map(b=>[b.id,{hunger:b.hunger,health:b.health,at:{...b.at},species:b.species,alert:b.alert?{...b.alert}:null}]));
   const oldPatches=w.frontierHazards.foodPatches.map(p=>({...p}));const eventFrom=w.events.length;
   const t=performance.now();stepWorld(w,1);chunkMs.push(performance.now()-t);ticks++;
   const season=calendar(w.minute).season;
   for(const p of w.frontierHazards.foodPatches){const b=oldPatches.find(x=>x.id===p.id);if(!b)continue;const growth=b.amount>=b.capacity||b.kind==='smallGame'&&b.amount<=0?0:Math.min(b.capacity-b.amount,Math.floor(b.progress+1/DAY*(b.kind==='browse'||b.kind==='seeds'?5:1)*({spring:.68,summer:.85,autumn:.58,winter:.26}[season])));const consumed=b.amount+growth-p.amount;const a=patchAccounting[p.id]??={opening:b.amount,grown:0,consumed:0,amount:p.amount};a.grown+=growth;a.consumed+=consumed;a.amount=p.amount;if(consumed<0||Math.abs(consumed-Math.round(consumed))>1e-8||a.opening+a.grown-a.consumed!==a.amount)observedIssues.push({minute:w.minute,type:'patch-accounting',id:p.id,before:b,after:p,growth,consumed});}
   for(const b of w.frontierHazards.beasts){const prev=old.get(b.id);if(!prev)continue;
    if(b.species==='duck'&&prev.hunger-b.hunger>1&&b.activity?.targetId==='habitat:duck'){const row={id:b.id,minute:w.minute,hungerBefore:prev.hunger,hungerAfter:b.hunger,at:{...b.at},source:'habitat:duck',patchBefore:oldPatches.find(p=>p.id==='habitat:duck')?.amount,patchAfter:w.frontierHazards.foodPatches.find(p=>p.id==='habitat:duck')?.amount};duck.seedMeals++;duck.seedNutritionRelief+=prev.hunger-b.hunger;appendFileSync(feedFile,JSON.stringify(row)+'\n');}
    if(b.species==='wolf'){
     if(b.alert?.preyId&&(!prev.alert?.preyId||prev.alert.preyId!==b.alert.preyId)){pursuits.started++;inc(perAnimal[b.id]??={},'pursuitStarts');}
     if(prev.alert?.preyId&&(!b.alert?.preyId||b.alert.preyId!==prev.alert.preyId)){pursuits.ended++;inc(pursuits.endReasons,b.status==='dead'?'predator_died':b.activity?.reason??'unknown');}
    }
   }
   observeIndividuals(priorIndividuals);
   for(const e of w.events.slice(eventFrom)){
    if(e.animalIds?.some(id=>id.startsWith('beast:')))appendFileSync(eventsFile,JSON.stringify(e)+'\n');
    if(e.text.startsWith('一只野鸭吃到一份')){duck.fishMealEvents++;if(duck.fishMealIds.length<30)duck.fishMealIds.push(e.id);}
    const predator=e.animalIds?.[0]&&registry.get(e.animalIds[0]),prey=e.animalIds?.[1]&&registry.get(e.animalIds[1]);
    if(predator?.species==='wolf'&&prey&&/^灰狼(咬伤|捕食)/.test(e.text)){pursuits.attacks++;inc(perAnimal[predator.id]??={},'attacks');if(e.text.startsWith('灰狼捕食'))pursuits.kills++;else pursuits.bites++;}
   }
   if(w.minute>=nextReport){
    const issues=[...fishState(w).errors.map(x=>({type:'fish-accounting',...x})),...ecologyChecks(w).map(x=>({type:'ecology-accounting',...x})),...scanFinite(w.frontierHazards).map(path=>({type:'nonfinite',path}))];if(issues.length)observedIssues.push(...issues.map(x=>({minute:w.minute,...x})));
    const before=hash(persistedState(w)),ct=performance.now();store.commit(w,committed);committed=w.revision;store.close();store=new WorldStore(resolve(dir,'world.sqlite'));w=store.loadForRuntime();assert.equal(hash(persistedState(w)),before,'persistence state mismatch');reloads++;
    chunkMs.sort((a,b)=>a-b);const timing={day:reloads,meanTickMs:chunkMs.reduce((s,n)=>s+n,0)/chunkMs.length,p95TickMs:chunkMs[Math.floor(chunkMs.length*.95)],maxTickMs:chunkMs.at(-1),checkpointMs:performance.now()-ct,dayWallSeconds:(performance.now()-lastCheckpointTime)/1000};timings.push(timing);lastCheckpointTime=performance.now();chunkMs=[];
    const s=sample('daily');log({...s,timing});if([35,112,224,336].includes(reloads)||w.minute>=end){writeFileSync(resolve(dir,`checkpoint-${reloads}d.json`),JSON.stringify({...s,births,deaths,perAnimal,timings},null,2));}
    nextReport+=DAY;
   }
  }
  store.commit(w,committed);committed=w.revision;
  const result={...sample('result'),completed:w.minute>=end,births,deaths,perAnimal,timings,individuals:[...registry.values()],sourcesAfter:sourceHashes()};allResults.push(result);writeFileSync(resolve(dir,'result.json'),JSON.stringify(result,null,2));log({type:'finished',seed,completed:result.completed,elapsedDays:result.elapsedDays,wallSeconds:result.wallSeconds,liveSpecies:result.liveSpecies,issues:observedIssues.length,sourceUnchanged:result.sourceUnchanged});
  if(!result.completed||observedIssues.length||!result.sourceUnchanged)process.exitCode=1;
 }catch(error){log({type:'error',message:error.message,stack:error.stack,minute:w.minute});throw error;}finally{store.close();}
}
writeFileSync(resolve(output,'summary.json'),JSON.stringify(allResults.map(({births,deaths,perAnimal,timings,individuals,...r})=>r),null,2));
