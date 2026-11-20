import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {runtimeOwnershipAnchor,type RuntimeOwnership} from './runtime-lock.js';
import {rehearseDetachedNativeLot} from './valley-spirit-ordinary-g1-rehearsal.js';
import {ownsOrdinaryCandidateReviewProof,type openOrdinaryCandidateSelection} from './valley-spirit-ordinary-multi-selection.js';
import type {WorldStore} from './store.js';

const MODE='ordinary-native-selected-detached-rehearsal/v1',SIGN='ordinary-native-selected-exact-review/v1';
const exact=(v:unknown,k:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(p=>Object.hasOwn(v,p));
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export type SelectedOrdinaryRehearsalOptions=Readonly<{mode:typeof MODE;reviewerPublicKeyPem:string}>;
type Pinned=Readonly<{reviewer:KeyObject;fingerprint:string}>;
const pins=new WeakSet<Pinned>();
export function pinSelectedOrdinaryRehearsal(v:unknown):Pinned|null{
 try{
  if(!exact(v,['mode','reviewerPublicKeyPem'])||v.mode!==MODE||typeof v.reviewerPublicKeyPem!=='string'||
   v.reviewerPublicKeyPem.length>256||!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(v.reviewerPublicKeyPem))return null;
  const reviewer=createPublicKey(v.reviewerPublicKeyPem);
  if(reviewer.asymmetricKeyType!=='ed25519')return null;
  const p=Object.freeze({reviewer,fingerprint:createHash('sha256').update(reviewer.export({type:'spki',format:'der'})).digest('hex')});
  pins.add(p);return p;
 }catch{return null;}
}
const keys=['schema','scope','reviewer','selectionDigest','approvalDigest','wireDigest','token','snapshot','headDigest','evidenceDigest'] as const;
export function encodeSelectedOrdinaryRehearsal(t:unknown){
 if(!exact(t,keys)||t.schema!==SIGN||!keys.slice(1).every(k=>hex(t[k])))return null;
 return Buffer.from(JSON.stringify([MODE,...keys.map(k=>t[k])]));
}

type Proof=NonNullable<ReturnType<ReturnType<typeof openOrdinaryCandidateSelection>['reviewProof']>>;
const positiveProofs=new WeakSet<object>();
export function ownsSelectedPositiveRehearsal(v:unknown){return !!v&&typeof v==='object'&&positiveProofs.has(v);}
type Evidence=NonNullable<ReturnType<WorldStore['readExactSelectedOrdinaryRehearsal']>>;
export function openSelectedOrdinaryRehearsal(owner:RuntimeOwnership,pin:Pinned,selection:()=>Proof|null,current:(snapshot:string,n:number)=>Evidence|null){
 const o=runtimeOwnershipAnchor(owner);
 if(!o||!pins.delete(pin))throw Error('ordinary_selected_review_untrusted_owner');
 const f=lstatSync(o.database,{bigint:true});
 if(!f.isFile()||f.nlink!==1n)throw Error('ordinary_selected_review_original_save');
 const scope=digest([MODE,String(f.dev),String(f.ino),pin.fingerprint]);
 let positive:Readonly<{reviewDigest:string;headDigest:string;snapshot:string;number:number;evidence:Evidence}>|null=null;
 const get=()=>{
  try{
   o.assertOwned();
   const file=lstatSync(o.database,{bigint:true});
   if(!file.isFile()||file.nlink!==1n||file.dev!==f.dev||file.ino!==f.ino)return null;
   const proof=selection();
   if(!proof||!ownsOrdinaryCandidateReviewProof(proof))return null;
   const {snapshot,number}=proof.selection;
   const e=current(snapshot,number);
   if(!e||selection()!==proof)return null;
   const terms=Object.freeze({schema:SIGN,scope,reviewer:pin.fingerprint,selectionDigest:digest(proof.selection),
    approvalDigest:proof.approvalDigest,wireDigest:proof.wireDigest,token:proof.token,snapshot,headDigest:e.headDigest,
    evidenceDigest:digest([e.site,e.offer,e.lot,e.rain,e.permissionVersion])});
   return {terms,e};
  }catch{return null;}
 };
 return Object.freeze({
  preview:()=>get()?.terms??null,
  currentPositive(){
   const x=get();
   return positive&&x?.terms.headDigest===positive.headDigest&&x.terms.snapshot===positive.snapshot?positive:null;
  },
  run(input:unknown){
   try{
    const s=get(),a=structuredClone(input);
    if(!s||!exact(a,['terms','signature'])||typeof a.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(a.signature))return null;
    const bytes=encodeSelectedOrdinaryRehearsal(a.terms),sig=Buffer.from(a.signature,'base64url');
    if(!bytes||sig.toString('base64url')!==a.signature||!bytes.equals(encodeSelectedOrdinaryRehearsal(s.terms)!)||
     !verify(null,bytes,pin.reviewer,sig)||digest(get()?.terms)!==digest(s.terms))return null;
    const {e}=s;
    const result=rehearseDetachedNativeLot(e.w,e.site,{worldId:e.w.id,opportunityId:e.offer.opportunityId,
     sourceResourceInstanceId:e.offer.sourceInstanceId,targetId:e.offer.targetId,rainEventId:e.rain.rainEventId,
     atUs:e.lot.atUs,reviewUntilUs:e.offer.eligibleUntilUs,lot:{...e.lot.lot,ownerId:e.offer.ownerId}});
    if(digest(get()?.terms)!==digest(s.terms))return null;
    if(result.status==='validated_detached'){
     positive=Object.freeze({reviewDigest:digest([s.terms,a.signature]),headDigest:s.terms.headDigest,
      snapshot:s.terms.snapshot,number:e.offer.number,evidence:e});
     positiveProofs.add(positive);
    }
    return Object.freeze({...result,selectedNumber:e.offer.number,selectionOperative:false as const,groundCapability:false as const,
     ordinaryPlacementAuthorized:false as const,executionAuthorized:false as const});
   }catch{return null;}
  },
 });
}
