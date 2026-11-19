import assert from 'node:assert/strict';
import {request} from 'node:http';
import {startOfflineChoiceDemoServer,OFFLINE_CHOICE_DEMO_PATH} from '../build/server/offline-choice-demo.js';

let externalFetch=0;
globalThis.fetch=()=>{externalFetch++;throw Error('external fetch forbidden');};
const {server,result}=await startOfflineChoiceDemoServer({port:0});
const address=server.address();
assert.equal(address.address,'127.0.0.1');
const send=(method,path)=>new Promise((resolve,reject)=>{
 const req=request({method,host:'127.0.0.1',port:address.port,path},res=>{
  let text='';res.setEncoding('utf8');res.on('data',x=>text+=x);
  res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:JSON.parse(text)}));
  res.on('error',reject);
 });req.on('error',reject);req.end();
});
try{
 const body=await send('GET',OFFLINE_CHOICE_DEMO_PATH);
 assert.equal(body.status,200);assert.match(body.headers['content-type'],/^application\/json/);
 assert.equal(body.headers['cache-control'],'no-store');
 assert.deepEqual(body.data,result);
 assert.deepEqual(Object.keys(result),['schemaVersion','driver','label','realModelCalls','fixture','choices','branches']);
 assert.equal(result.schemaVersion,1);assert.equal(result.driver,'synthetic-model-decisions');assert.equal(result.realModelCalls,0);
 assert.equal(result.fixture.source,'generated-fixture');assert.match(result.fixture.initialWorldDigest,/^[a-f0-9]{64}$/);
 assert.equal(result.fixture.startMinute,600);
 assert.deepEqual(result.choices.map(c=>c.id),['cook','preserve']);
 assert.deepEqual(result.branches.map(b=>[b.choiceId,b.state,b.endMinute,b.evidence.kind,b.evidence.quantity]),[
  ['cook','completed',620,'cooked',1],['preserve','completed',660,'preserved',2],['invalid','rejected',600,'choice-rejected',0],
 ]);
 assert.equal(result.branches[1].evidence.expiresAt,660+56*1440);
 for(const b of result.branches){
  assert.deepEqual(b.before,result.fixture.stock);
  assert.equal(b.startMinute,result.fixture.startMinute);
  for(const k of Object.keys(b.before))assert.equal(b.changes[k],b.after[k]-b.before[k]);
 }
 const publicContent=JSON.stringify(body.data);
 for(const banned of ['messages','payload','requestId','actorRevision','schemaVersion":2','worldId','usage','budget','charges','apiKey'])assert.ok(!publicContent.includes(banned));
 assert.equal((await send('POST',OFFLINE_CHOICE_DEMO_PATH)).status,404);
 assert.equal((await send('GET','/ai-town/api/world')).status,404);
 assert.equal((await send('GET','/ai-town/api/seasonal-model')).status,404);
 assert.deepEqual((await send('GET',OFFLINE_CHOICE_DEMO_PATH)).data,body.data);
 assert.equal(externalFetch,0);
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
console.log('offline synthetic loop: cook, preserve, invalid choice, durable restarts and read-only HTTP');
