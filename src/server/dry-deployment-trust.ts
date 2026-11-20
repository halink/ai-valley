/** Disconnected deployment policy rehearsal. No default root or runtime authority. */
import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {evaluateProductionHttpAdmission} from './production-model-admission.js';
import {modelEvidenceHash,productionGatedCandidateContract,type ProductionCandidateContract} from './production-model-journal.js';

export const DRY_DEPLOYMENT_ROLES=Object.freeze(['ordinary-g2-single-effect-policy','provider-reconciled-zero-cost-run'] as const);
type Role=(typeof DRY_DEPLOYMENT_ROLES)[number];
type Scope=Readonly<{originDigest:string;worldId:string;runId:string}>;
type Effect=Readonly<{headDigest:string;opportunityDigest:string;kind:'native-aged-fruit-ground-placement';
 units:1;sourceDigest:string;targetDigest:string}>;
type Signed=Readonly<{utf8:string;signature:string}>;
type Chain=Readonly<{delegation:Signed;permit:Signed}>;
type Boot=Readonly<{scope:Scope;clock:()=>number;roots:Readonly<Record<Role,string>>}>;
type Denial=Readonly<{admitted:false;liveAuthorized:false;reason:string}>;
type Result=Denial|Readonly<{admitted:true;liveAuthorized:false;role:Role}>;
const DOMAIN='ai-valley-dry-deployment-trust/v1';
const MAX_WINDOW=15*60_000;
const CAP=1024;
const digest=(v:unknown):v is string=>typeof v==='string'&&v.length===64&&/^[0-9a-f]{64}$/.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&!Object.is(v,-0);
const label=(v:unknown,n:number,colon=false):v is string=>typeof v==='string'&&v.length>=1&&v.length<=n&&
 !(colon?/[^a-zA-Z0-9:_-]/:/[^a-zA-Z0-9_-]/).test(v);
const fail=(reason:string):never=>{throw Error(reason);};
const denied=(reason:string):Denial=>Object.freeze({admitted:false,liveAuthorized:false,reason});
function snapshot(o:unknown,k:readonly string[]):Record<string,unknown>|null{
 if(!o||typeof o!=='object'||Object.getPrototypeOf(o)!==Object.prototype||Reflect.ownKeys(o).length!==k.length)return null;
 const result:Record<string,unknown>={};
 for(const key of k){
  const p=Object.getOwnPropertyDescriptor(o,key);
  if(!p||!('value' in p))return null;
  result[key]=p.value;
 }
 return result;
}
const exact=(o:unknown,k:readonly string[]):o is Record<string,unknown>=>snapshot(o,k)!==null;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function shaped(s:unknown):s is Scope{
 return exact(s,['originDigest','worldId','runId'])&&digest(s.originDigest)&&label(s.worldId,160,true)&&label(s.runId,96);
}
function ed25519(spki:unknown){
 if(typeof spki!=='string'||!/^[A-Za-z0-9_-]{59}$/.test(spki))return fail('public_key_invalid');
 const der=Buffer.from(spki,'base64url');
 if(der.toString('base64url')!==spki||der.length!==44||der.subarray(0,12).toString('hex')!=='302a300506032b6570032100')return fail('public_key_invalid');
 // Reject non-canonical y and small-order public points (sign bit masked).
 // OpenSSL verifies signatures; an Ed25519 SPKI parser alone is not proof of key strength.
 const y=Buffer.from(der.subarray(12));y[31]&=127;
 const yHex=y.toString('hex'),p=2n**255n-19n;
 if(BigInt('0x'+Buffer.from(y).reverse().toString('hex'))>=p||[
  '00'.repeat(32),'01'+'00'.repeat(31),'ec'+'ff'.repeat(30)+'7f',
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
 ].includes(yHex))return fail('public_key_invalid');
 const key=createPublicKey({key:der,type:'spki',format:'der'});
 if(key.asymmetricKeyType!=='ed25519')return fail('public_key_invalid');
 return {key,spki,fingerprint:hash(spki)};
}
function bytes(s:unknown,key:KeyObject,len:number){
 const a=snapshot(s,['utf8','signature']);
 if(!a||typeof a.utf8!=='string'||a.utf8.length>1024||
  !/^[\x20-\x7e]+$/.test(a.utf8)||typeof a.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(a.signature))
  return fail('envelope_invalid');
 const sig=Buffer.from(a.signature,'base64url');
 if(sig.toString('base64url')!==a.signature||sig.length!==64||!verify(null,Buffer.from(a.utf8),key,sig))return fail('signature_invalid');
 const tuple:unknown=JSON.parse(a.utf8);
 if(!Array.isArray(tuple)||tuple.length!==len||JSON.stringify(tuple)!==a.utf8)return fail('canonical_bytes_invalid');
 return {tuple,utf8:a.utf8};
}
const time=(start:unknown,end:unknown,now:number)=>integer(start)&&integer(end)&&
 start<=now&&now<end&&end-start<=MAX_WINDOW;
function signedScope(a:unknown[],kind:'delegate'|'permit',role:Role,s:Scope){
 if(a[0]!==DOMAIN||a[1]!==kind||a[2]!==role||a[3]!==s.originDigest||a[4]!==s.worldId||a[5]!==s.runId)
  return fail('scope_or_role_invalid');
}
function parseProviderEvidence(json:unknown){
 if(typeof json!=='string'||json.length>4096||!/^[\x20-\x7e]+$/.test(json))return fail('provider_evidence_invalid');
 const r:unknown=JSON.parse(json);
 if(JSON.stringify(r)!==json||!exact(r,['schema','provider','model','endpoint','scope','authorization','previousRequest','pricing'])||
  !exact(r.scope,['runId','worldId','maxRequests','createdAtMs','deadlineAtMs','requestTimeoutMs'])||
  !exact(r.authorization,['sourceHash','dataScope','spendingLimitCny'])||
  !exact(r.previousRequest,['requestEvidenceHash','resolutionEvidenceHash','billingEvidenceHash','remoteOutcome','actualCostCny','reconciledAtMs'])||
  !exact(r.pricing,['sourceUrl','sourceHash','model','checkedAtMs','validUntilMs','inputCnyPerMillion','outputCnyPerMillion','otherApplicableChargesCny']))
  return fail('provider_evidence_invalid');
 return r;
}
/** Call only from trusted boot code: roots, the original scope and the clock are
 * code capabilities, never request/env/save inputs. Passing no boot denies all.
 * The result is a rehearsal verdict, NOT a writer or live admission token. */
export function createDryDeploymentTrust(boot?:Boot){
 const state=(()=>{
  try{
   const b=snapshot(boot,['scope','clock','roots']);
   if(!b||typeof b.clock!=='function')return null;
   const scope=snapshot(b.scope,['originDigest','worldId','runId']),roots=snapshot(b.roots,DRY_DEPLOYMENT_ROLES);
   if(!shaped(scope)||!roots)return null;
   const ordinary=ed25519(roots[DRY_DEPLOYMENT_ROLES[0]]),provider=ed25519(roots[DRY_DEPLOYMENT_ROLES[1]]);
   if(ordinary.spki===provider.spki)return null;
   return {scope:Object.freeze({...scope}),clock:b.clock as Boot['clock'],roots:{[DRY_DEPLOYMENT_ROLES[0]]:ordinary,[DRY_DEPLOYMENT_ROLES[1]]:provider}};
  }catch{return null;}
 })();
 const used=new Set<string>(),signerRoles=new Map<string,Role>();
 let lastNow=-1,active=false;
 function inspect(role:Role,chain:Chain,pick:(now:number,scope:Scope)=>{binding:readonly string[];opportunity:string}):Result{
  if(!state)return denied('trusted_boot_unconfigured');
  if(active)return denied('inspection_reentrant');
  active=true;
  try{
   const now:unknown=state.clock();
   if(!integer(now)||now<lastNow)return denied('trusted_clock_invalid');
   lastNow=now;
   const c=snapshot(chain,['delegation','permit']);
   if(!c)return denied('envelope_invalid');
   const root=state.roots[role],delegation=bytes(c.delegation,root.key,9),d=delegation.tuple;
   signedScope(d,'delegate',role,state.scope);
   const signer=ed25519(d[6]);
   if(Object.values(state.roots).some(pin=>pin.spki===signer.spki)||
    signerRoles.has(signer.fingerprint)&&signerRoles.get(signer.fingerprint)!==role)return denied('delegated_signer_invalid');
   if(!time(d[7],d[8],now))return denied('delegation_time_invalid');
   const p=bytes(c.permit,signer.key,13).tuple;
   signedScope(p,'permit',role,state.scope);
   if(p[6]!==hash(delegation.utf8)||!time(p[7],p[8],now)||Number(p[7])<Number(d[7])||Number(p[8])>Number(d[8]))
    return denied('permit_time_or_delegation_invalid');
   if(!digest(p[9]))return denied('nonce_invalid');
   const expected=pick(now,state.scope);
   if(expected.binding.some((v,i)=>p[i+10]!==v))return denied('permit_evidence_mismatch');
   const nonce='nonce:'+role+':'+p[9],opportunity='opportunity:'+role+':'+expected.opportunity;
   if(used.has(nonce)||used.has(opportunity))return denied('replayed_permit_or_opportunity');
   if(used.size>=CAP*2)return denied('rehearsal_replay_cap');
   signerRoles.set(signer.fingerprint,role);
   used.add(nonce);used.add(opportunity);
   return Object.freeze({admitted:true,liveAuthorized:false,role});
  }catch(error){
   const message=error instanceof Error?error.message:'';
   return denied(/^[a-z_]{1,48}$/.test(message)?message:'evidence_invalid');
  }finally{active=false;}
 }
 return Object.freeze({
  inspectOrdinary(chain:Chain,witness:Effect):Result{
   return inspect(DRY_DEPLOYMENT_ROLES[0],chain,()=>{
    const expected=snapshot(witness,['headDigest','opportunityDigest','kind','units','sourceDigest','targetDigest']);
    if(!expected||!digest(expected.headDigest)||
     !digest(expected.opportunityDigest)||expected.kind!=='native-aged-fruit-ground-placement'||expected.units!==1||
     !digest(expected.sourceDigest)||!digest(expected.targetDigest))return fail('single_effect_shape_invalid');
    const effect=hash(JSON.stringify([DOMAIN,'effect',expected.kind,expected.units,expected.sourceDigest,expected.targetDigest]));
    return {binding:[expected.headDigest,expected.opportunityDigest,effect],opportunity:expected.opportunityDigest};
   });
  },
  inspectProvider(chain:Chain,candidate:ProductionCandidateContract,evidenceJson:string,expectedAccountScopeDigest:string):Result{
   return inspect(DRY_DEPLOYMENT_ROLES[1],chain,(now,scope)=>{
    const contract=snapshot(candidate,['schema','executionKind','admissionHash','runId','worldId','provider','model','endpoint',
     'maxRequests','createdAtMs','deadlineAtMs','requestTimeoutMs','modelSlots','retries','fallback','spendingLimitCny']);
    if(!contract||!digest(expectedAccountScopeDigest)||
     contract.executionKind!=='gated-production-http-candidate'||contract.worldId!==scope.worldId||contract.runId!==scope.runId||
     !digest(contract.admissionHash)||!integer(contract.maxRequests)||!integer(contract.createdAtMs)||
     !integer(contract.deadlineAtMs)||!integer(contract.requestTimeoutMs))return fail('provider_contract_invalid');
    const canonical=productionGatedCandidateContract({runId:scope.runId,worldId:scope.worldId,admissionHash:contract.admissionHash,
     maxRequests:contract.maxRequests,createdAtMs:contract.createdAtMs,deadlineAtMs:contract.deadlineAtMs,requestTimeoutMs:contract.requestTimeoutMs});
    if(Object.entries(canonical).some(([key,value])=>contract[key]!==value))return fail('provider_contract_invalid');
    const result=evaluateProductionHttpAdmission(canonical,parseProviderEvidence(evidenceJson),now);
    if(!result.allowed)return fail(result.reason);
    return {binding:[modelEvidenceHash(canonical),result.hash,expectedAccountScopeDigest],opportunity:scope.runId};
   });
  },
 });
}
