import {DatabaseSync} from 'node:sqlite';
import {encodeDeveloperMvpFruitFallSignedTerms,type DeveloperMvpFruitFallSignedApproval} from './valley-spirit-fixture-signed-approval.js';

type State='scheduled'|'retry_blocked'|'expired'|'denied'|'committed';
interface Row {approval:DeveloperMvpFruitFallSignedApproval;state:State;effectId?:string}
const LIMIT=128,SWEEP=8,MAX=128*1024;
const states=new Set<State>(['scheduled','retry_blocked','expired','denied','committed']);
type Outcome=Pick<Row,'state'|'effectId'>;
const SCHEMA='CREATE TABLE spirit_fixture_due (scope TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL)';

/** Independent mirror only. Writes never happen inside the world transaction;
 * a subsequent pass consults the world receipt before timeout/retry. */
export class DeveloperSpiritDueQueue {
 private readonly db:DatabaseSync;
 private after:string|null=null;
 constructor(database:string,private readonly scopeId:string,private readonly assertOwned:()=>void,
  private readonly readOnly=false){
  assertOwned();this.db=new DatabaseSync(database,{readOnly});
  try{
   const present=this.schema();
   if(!present&&!readOnly){this.db.exec(SCHEMA);this.schema();}
  }catch(e){this.db.close();throw e;}
 }
 /** Exact known owned object only. Never execute a trigger attached to a
  * counterfeit table, and never replace or initialize an unknown schema. */
 private schema():boolean {
  const row=this.db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='spirit_fixture_due' COLLATE NOCASE").get();
  const trigger=this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND tbl_name='spirit_fixture_due' COLLATE NOCASE").get();
  if(!row&&!trigger)return false;
  if(!row||row.type!=='table'||typeof row.sql!=='string'||row.sql.replace(/\s+/g,' ').trim()!==SCHEMA||trigger)
   throw Error('unknown_due_schema');
  return true;
 }
 close(){this.db.close();}
 private read(){
  this.assertOwned();
  if(!this.schema())return {body:null,rows:[] as Row[]};
  const row=this.db.prepare('SELECT version,body FROM spirit_fixture_due WHERE scope=?').get(this.scopeId);
  if(!row)return {body:null,rows:[] as Row[]};
  if(row.version!==1||typeof row.body!=='string'||Buffer.byteLength(row.body)>MAX)throw Error('unknown_due_state');
  const rows=JSON.parse(row.body) as Row[];
  if(!Array.isArray(rows)||rows.length>LIMIT||rows.some(r=>!r||!encodeDeveloperMvpFruitFallSignedTerms(r.approval?.terms)||
   r.approval.terms.fixtureScopeId!==this.scopeId||Object.keys(r.approval).length!==2||
   typeof r.approval.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(r.approval.signature)||!states.has(r.state)||
   Object.keys(r).length!==(r.state==='committed'?3:2)||(r.state==='committed'?!/^valley-effect:[a-f0-9]{64}$/.test(r.effectId??''):Object.hasOwn(r,'effectId')))||
   new Set(rows.map(r=>r.approval.terms.approvalId)).size!==rows.length)throw Error('unknown_due_state');
  return {body:row.body,rows};
 }
 private write(previous:string|null,rows:Row[]){
  this.assertOwned();if(this.readOnly||!this.schema())throw Error('due_readonly_or_unknown');
  const body=JSON.stringify(rows);
  if(Buffer.byteLength(body)>MAX)throw Error('due_capacity');
  const changed=previous===null?this.db.prepare('INSERT OR IGNORE INTO spirit_fixture_due VALUES (?,1,?)').run(this.scopeId,body)
   :this.db.prepare('UPDATE spirit_fixture_due SET body=? WHERE scope=? AND version=1 AND body=?').run(body,this.scopeId,previous);
  if(changed.changes!==1)throw Error('due_changed');
 }
 enqueue(approval:DeveloperMvpFruitFallSignedApproval){
  const {body,rows}=this.read(),id=approval.terms.approvalId;
  const previous=rows.find(r=>r.approval.terms.approvalId===id);
  if(previous)return JSON.stringify(previous.approval)===JSON.stringify(approval)?'unchanged':'conflict';
  if(rows.length===LIMIT)return 'capacity';
  this.write(body,[...rows,{approval,state:'scheduled'}]);return 'scheduled';
 }
 view(id:string,confirmCommitted?:(approval:DeveloperMvpFruitFallSignedApproval,effectId:string)=>boolean){
  const row=this.read().rows.find(r=>r.approval.terms.approvalId===id);
  if(row?.state==='committed'&&(!row.effectId||!confirmCommitted?.(structuredClone(row.approval),row.effectId)))return null;
  return row?{state:row.state,effectId:row.effectId,firstMicroMinute:row.approval.terms.firstMicroMinute,
   expiresMicroMinute:row.approval.terms.expiresMicroMinute}:null;
 }
 sweep(now:number,evaluate:(approval:DeveloperMvpFruitFallSignedApproval)=>Outcome){
  if(!Number.isSafeInteger(now)||now<0)throw Error('invalid_due_clock');
  let settled=0,blocked=0;
  const due=this.read().rows.filter(r=>(r.state==='scheduled'||r.state==='retry_blocked')&&r.approval.terms.firstMicroMinute<=now)
   .map(r=>r.approval.terms.approvalId).sort();
  const from=Math.max(0,this.after===null?0:due.findIndex(id=>id>this.after!));
  const ids=[...due.slice(from),...due.slice(0,from)].slice(0,SWEEP);
  for(const id of ids){
   this.after=id;
   const {body,rows}=this.read(),row=rows.find(r=>r.approval.terms.approvalId===id);
   if(!row||(row.state!=='scheduled'&&row.state!=='retry_blocked'))continue;
   const result=evaluate(structuredClone(row.approval));
   this.write(body,rows.map(r=>r===row?{approval:r.approval,...result}:r));
   if(result.state==='retry_blocked')blocked++;else settled++;
  }
  return {settled,blocked};
 }
}
