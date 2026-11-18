import {ModelBudget} from './model-budget.js';
import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {ModelCharge,World} from '../shared/types.js';
import {DEEPSEEK_MODEL,modelLimits} from './model-completion.js';

const table='seasonal_model_ledger';
const model=DEEPSEEK_MODEL;
export const seasonalModelPolicy={model,account:'offline-synthetic',slots:1,rpm:modelLimits[model].rpm,tpm:modelLimits[model].tpm} as const;
const count=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:unknown,keys:string[])=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export const modelDigest=(s:string)=>createHash('sha256').update(s).digest('hex');
export type SeasonalUsage={inputTokens?:number;outputTokens?:number};
export interface SeasonalRequest {
 id:string;actorId:string;actorRevision:number;minute:number;worldRevision:number;at:number;
 // Exact serialized provider payload, private to this ledger. Never projected.
 contextVersion:1;menuVersion:1;menuDigest:string;payload:string;digest:string;state:'intent'|'accepted'|'rejected';finishedAt:number|null;
 usage:SeasonalUsage|null;
}
export interface SeasonalLedger {schemaVersion:1;worldId:string;nextSequence:number;lastWall:number;charges:ModelCharge[];requests:SeasonalRequest[];}
export function readSeasonalLedger(db:DatabaseSync,world:Pick<World,'id'|'revision'|'minute'>|null,allowed:boolean):SeasonalLedger|null {
 const schema=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name=?").get(table);
 if(!schema)return null;
 if(!allowed)throw Error('seasonal_model_save_requires_explicit_entry');
 const sql='CREATE TABLE seasonal_model_ledger (slot INTEGER PRIMARY KEY CHECK(slot=1), body TEXT NOT NULL)';
 if(!world||schema.type!=='table'||schema.sql!==sql)throw Error('seasonal_model_ledger_schema');
 const records=db.prepare('SELECT slot, CASE WHEN length(CAST(body AS BLOB))<=? THEN body ELSE NULL END AS body FROM seasonal_model_ledger LIMIT 2').all(32*1024*1024);
 if(records.length!==1||records[0].slot!==1||typeof records[0].body!=='string')throw Error('seasonal_model_ledger_invalid');
 const ledger:unknown=JSON.parse(records[0].body);validateSeasonalLedger(ledger,world);return ledger;
}
export function validateSeasonalLedger(x:unknown,world:Pick<World,'id'|'revision'|'minute'>):asserts x is SeasonalLedger {
 const invalid=()=>{throw Error('seasonal_model_ledger_invalid');};
 if(!exact(x,['schemaVersion','worldId','nextSequence','lastWall','charges','requests']))return invalid();
 const s=x as unknown as SeasonalLedger;
 if(s.schemaVersion!==1||s.worldId!==world.id||!count(s.lastWall)||!Array.isArray(s.charges)||!Array.isArray(s.requests)||s.requests.length>1000||s.nextSequence!==s.requests.length+1||s.charges.length>seasonalModelPolicy.rpm)return invalid();
 let pending=false,previousWall=-1;
 let replay:ModelCharge[]=[];
 for(const [i,r] of s.requests.entries()){
  const payload=r?.payload;
  if(!exact(r,['id','actorId','actorRevision','minute','worldRevision','at','contextVersion','menuVersion','menuDigest','payload','digest','state','finishedAt','usage'])||r.id!==s.worldId+':seasonal-model:'+(i+1)||typeof r.actorId!=='string'||!r.actorId||!count(r.actorRevision)||!Number.isFinite(r.minute)||r.minute<0||r.minute>world.minute||!count(r.worldRevision)||r.worldRevision>=world.revision||!count(r.at)||r.at<previousWall||r.at>s.lastWall||r.contextVersion!==1||r.menuVersion!==1||typeof r.menuDigest!=='string'||!(/^[0-9a-f]{64}$/).test(r.menuDigest)||typeof payload!=='string'||Buffer.byteLength(payload)>modelLimits[model].inputBytes+2048||modelDigest(payload)!==r.digest||!['intent','accepted','rejected'].includes(r.state)||pending)return invalid();
  const request=JSON.parse(payload) as {model?:string;messages?:unknown};
  if(request.model!==model||!Array.isArray(request.messages))return invalid();
  const input=Buffer.byteLength(JSON.stringify(request.messages),'utf8');const limits=modelLimits[model];
  if(input>limits.inputBytes)return invalid();
  const budget=new ModelBudget(seasonalModelPolicy.rpm,seasonalModelPolicy.tpm,replay,r.at);
  const charge=budget.reserve(r.at,input+512,limits.answerTokens+limits.thinkingTokens);if(!charge)return invalid();
  if(r.state==='intent'){if(r.finishedAt!==null||r.usage!==null)return invalid();pending=true;previousWall=r.at;}
  else{
   if(!count(r.finishedAt)||r.finishedAt<r.at||r.finishedAt>s.lastWall||r.usage!==null&&(!object(r.usage)||!Object.keys(r.usage).length||Object.entries(r.usage).some(([k,v])=>!['inputTokens','outputTokens'].includes(k)||!count(v))))return invalid();
   finishSeasonalCharge(budget,charge,r.finishedAt,r.usage);previousWall=r.finishedAt;
  }
  replay=budget.snapshot();
 }
 if(previousWall!==s.lastWall||JSON.stringify(replay)!==JSON.stringify(s.charges))return invalid();
 let open=0;
 for(const c of s.charges){
  if(!object(c)||!['startedAt','input','output'].every(k=>count(c[k]))||c.startedAt>s.lastWall||Object.keys(c).some(k=>!['startedAt','finishedAt','input','output'].includes(k))||c.finishedAt!==undefined&&(!count(c.finishedAt)||c.finishedAt<c.startedAt||c.finishedAt>s.lastWall))return invalid();
  if(c.finishedAt===undefined){if(c.startedAt!==s.requests.at(-1)?.at)return invalid();open++;}
 }
 if(open!==(pending?1:0))return invalid();
}
/** Missing fields keep their own estimate; never erase the other known field. */
export function finishSeasonalCharge(budget:ModelBudget,charge:ModelCharge,time:number,usage:SeasonalUsage|null){
 budget.finish(charge,time,{inputTokens:usage?.inputTokens??charge.input,outputTokens:usage?.outputTokens??charge.output});
}
export function writeSeasonalLedger(db:DatabaseSync,next:SeasonalLedger,prior:SeasonalLedger|null,world:World):void {
 validateSeasonalLedger(next,world);
 if(Buffer.byteLength(JSON.stringify(next))>32*1024*1024)throw Error('seasonal_model_ledger_limit');
 if(prior){
  const n=prior.requests.length;
  const previous=prior.requests.at(-1),last=next.requests.at(-1);
  const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  if(next.lastWall<prior.lastWall||!(
   previous?.state==='intent'?next.requests.length===n&&last?.state!=='intent'&&same(prior.requests.slice(0,-1),next.requests.slice(0,-1))&&same(previous,{...last,state:'intent',finishedAt:null,usage:null})
   :next.requests.length===n+1&&last?.state==='intent'&&same(prior.requests,next.requests.slice(0,-1))
  ))throw Error('seasonal_model_ledger_transition');
 }else{
  if(next.requests.length!==1||next.requests[0].state!=='intent')throw Error('seasonal_model_ledger_transition');
  db.exec('CREATE TABLE seasonal_model_ledger (slot INTEGER PRIMARY KEY CHECK(slot=1), body TEXT NOT NULL)');
 }
 db.prepare('INSERT INTO seasonal_model_ledger(slot,body) VALUES(1,?) ON CONFLICT(slot) DO UPDATE SET body=excluded.body').run(JSON.stringify(next));
}
