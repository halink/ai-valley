import {createHash,createPublicKey,randomBytes,verify,type KeyObject} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {runtimeOwnershipAnchor,type RuntimeOwnership} from './runtime-lock.js';
import type {buildOrdinaryMultiCandidatePreview} from './valley-spirit-ordinary-multi-candidate.js';

const SCHEMA='ordinary-native-candidate-numbered-selection/v1',SIGN='ordinary-native-candidate-exact-detached-approval/v1';
const MODE='ordinary-native-candidate-memory-only/v1',MAX_REPLY=180;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v:unknown,k:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(p=>Object.hasOwn(v,p));
type Menu=NonNullable<ReturnType<typeof buildOrdinaryMultiCandidatePreview>>;
type Memory=Readonly<{kind:typeof MODE}>;
type Call={bytes:string;finish:(v:unknown)=>void};
type Invoke=(bytes:string,signal:AbortSignal)=>Promise<unknown>;
const transports=new WeakMap<Memory,{invoke:Invoke;claimed:boolean}>();
export function createOrdinaryCandidateMemory(){
 const transport=Object.freeze({kind:MODE}),calls:Call[]=[];
 transports.set(transport,{claimed:false,invoke:(bytes,signal)=>new Promise(resolve=>{
  if(signal.aborted){resolve(null);return;}
  const finish=(v:unknown)=>{signal.removeEventListener('abort',cancel);resolve(typeof v==='string'?v:null);};
  const cancel=()=>finish(null);
  signal.addEventListener('abort',cancel,{once:true});
  calls.push({bytes,finish});
 })});
 return {transport,requests:()=>calls.map(c=>c.bytes),reply:(index:number,v:unknown)=>calls[index]?.finish(v),disconnect:(index:number)=>calls[index]?.finish(null)};
}
export type OrdinaryCandidateSelectionOptions=Readonly<{mode:typeof MODE;reviewerPublicKeyPem:string;transport:Memory}>;
type Pinned=Readonly<{reviewer:KeyObject;fingerprint:string;invoke:Invoke}>;
const pinned=new WeakSet<Pinned>();
export function pinOrdinaryCandidateSelection(v:unknown):Pinned|null{
 try{
  if(!exact(v,['mode','reviewerPublicKeyPem','transport'])||v.mode!==MODE||typeof v.reviewerPublicKeyPem!=='string'||
   v.reviewerPublicKeyPem.length>256||!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(v.reviewerPublicKeyPem))return null;
  const reviewer=createPublicKey(v.reviewerPublicKeyPem),memory=transports.get(v.transport as Memory);
  if(reviewer.asymmetricKeyType!=='ed25519'||!memory||memory.claimed)return null;
  memory.claimed=true;
  const p=Object.freeze({reviewer,fingerprint:createHash('sha256').update(reviewer.export({type:'spki',format:'der'})).digest('hex'),invoke:memory.invoke});
  pinned.add(p);return p;
 }catch{return null;}
}

const termKeys=['schema','scope','reviewer','snapshot','wireDigest','token'] as const;
type Terms=Readonly<{schema:typeof SIGN;scope:string;reviewer:string;snapshot:string;wireDigest:string;token:string}>;
export function encodeOrdinaryCandidateSelection(t:unknown){
 if(!exact(t,termKeys)||t.schema!==SIGN||!termKeys.slice(1).every(k=>hex(t[k])))return null;
 return Buffer.from(JSON.stringify([MODE,...termKeys.map(k=>t[k])]));
}
const nativeReviewProofs=new WeakSet<object>();
export function ownsOrdinaryCandidateReviewProof(v:unknown){return typeof v==='object'&&v!==null&&nativeReviewProofs.has(v);}
type Result=Readonly<{status:'selected-detached-preview';number:number;snapshot:string;selectionOperative:false;executionAuthorized:false}>;
type IntentGuard=Readonly<{signedSnapshot:(menu:Menu)=>string|null;reserve:(menu:Menu,approvalDigest:string)=>boolean}>;
/** Transport and selected result always ephemeral. Only an explicit ordinary
 * store guard may durably reserve the opportunity before the memory call. */
export function openOrdinaryCandidateSelection(owner:RuntimeOwnership,pin:Pinned,current:()=>Menu|null,intent?:IntentGuard){
 const o=runtimeOwnershipAnchor(owner);
 if(!o||!pinned.delete(pin))throw Error('ordinary_candidate_untrusted_owner');
 o.assertOwned();
 const f=lstatSync(o.database,{bigint:true});
 if(!f.isFile()||f.nlink!==1n)throw Error('ordinary_candidate_original_save');
 const scope=digest(JSON.stringify([MODE,String(f.dev),String(f.ino),pin.fingerprint]));
 const token=randomBytes(32).toString('hex'),abort=new AbortController();
 let used=false,closed=false,selected:Result|null=null,selectedSigningSnapshot:string|null=null;
 let proof:Readonly<{approvalDigest:string;wireDigest:string;token:string;selection:Result}>|null=null;
 const get=()=>{
  try{
   if(closed)return null;
   o.assertOwned();
   const now=lstatSync(o.database,{bigint:true});
   if(!now.isFile()||now.nlink!==1n||now.dev!==f.dev||now.ino!==f.ino)return null;
   const m=current();
   if(!m||new Set(m.selectionTraits.map(v=>v.stockBand+':'+v.remainingBand)).size<2)return null;
   const wire=JSON.stringify({schema:SCHEMA,token,options:m.selectionTraits});
   const signingSnapshot=intent?intent.signedSnapshot(m):m.snapshot;
   if(!signingSnapshot)return null;
   const t:Terms=Object.freeze({schema:SIGN,scope,reviewer:pin.fingerprint,snapshot:signingSnapshot,wireDigest:digest(wire),token});
   return {m,wire,t};
  }catch{return null;}
 };
 const valid=(raw:unknown,options:Menu['selectionTraits'])=>{
  if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX_REPLY)return null;
  try{
   const d:unknown=JSON.parse(raw);
   if(!exact(d,['schema','token','number'])||d.schema!==SCHEMA||d.token!==token||!Number.isSafeInteger(d.number)||
      !options.some(v=>v.number===d.number)||raw!==JSON.stringify({schema:SCHEMA,token,number:d.number}))return null;
   return d.number as number;
  }catch{return null;}
 };
 return Object.freeze({
  preview(){
   const s=!used&&get();
   return s?Object.freeze({terms:s.t,anonymousRequestBytes:s.wire}):null;
  },
  async select(input:unknown){
   if(used||closed)return null;
   try{
    const s=get(),a=structuredClone(input);
    if(!s||!exact(a,['terms','signature'])||typeof a.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(a.signature))return null;
    const bytes=encodeOrdinaryCandidateSelection(a.terms),sig=Buffer.from(a.signature,'base64url');
    if(!bytes||sig.toString('base64url')!==a.signature||!bytes.equals(encodeOrdinaryCandidateSelection(s.t)!)||
     !verify(null,bytes,pin.reviewer,sig))return null;
    const again=get();
    if(!again||again.t.snapshot!==s.t.snapshot||again.m.snapshot!==s.m.snapshot||again.wire!==s.wire)return null;
    const approvalDigest=digest(JSON.stringify([bytes.toString('base64url'),a.signature]));
    if(intent&&!intent.reserve(again.m,approvalDigest))return null;
    used=true;
    const response=await pin.invoke(s.wire,abort.signal),number=valid(response,s.m.selectionTraits),after=get();
    if(number===null||!after||after.t.snapshot!==s.t.snapshot||after.m.snapshot!==s.m.snapshot||after.wire!==s.wire)return null;
    selected=Object.freeze({status:'selected-detached-preview',number,snapshot:s.m.snapshot,selectionOperative:false,executionAuthorized:false});
    selectedSigningSnapshot=s.t.snapshot;
    proof=Object.freeze({approvalDigest,wireDigest:s.t.wireDigest,token,selection:selected});
    nativeReviewProofs.add(proof);
    return selected;
   }catch{return null;}
  },
  latest(){
   if(!selected)return null;
   const now=get();
   return now?.m.snapshot===selected.snapshot&&now.t.snapshot===selectedSigningSnapshot?selected:null;
  },
  reviewProof(){
   if(!proof)return null;
   const now=get();
   return now?.m.snapshot===proof.selection.snapshot&&now.t.snapshot===selectedSigningSnapshot&&now.t.wireDigest===proof.wireDigest?proof:null;
  },
  close(){closed=true;selected=null;selectedSigningSnapshot=null;proof=null;abort.abort();},
 });
}
