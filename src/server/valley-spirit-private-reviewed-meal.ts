import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {acquireDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureKey} from './valley-spirit-fixture-files.js';
import {readNativeMvpMealV2Receipt} from './valley-spirit-meal-custody.js';
import {readNativeValidationWeatherHead} from './valley-spirit-native-basis.js';
import {SqliteValleySpiritLifeStore,valleySpiritLifeAuthorityOnConnection,type ValleySpiritLifeGrantDecision} from './valley-spirit-life-authority.js';
import {valleySpiritLifeBinding,type ValleySpiritLifeReceipt} from './valley-spirit-life-facts.js';
import {ValleySpiritLifeAlmanac} from './valley-spirit-life-almanac.js';

const schema='valley-private-native-meal-disclosure/v1';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const hex=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const world=(s:unknown):s is string=>typeof s==='string'&&/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(s);
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s);
const exact=(u:unknown,ks:readonly string[]):u is Record<string,unknown>=>!!u&&typeof u==='object'&&!Array.isArray(u)&&
 Object.keys(u).length===ks.length&&ks.every(k=>Object.hasOwn(u,k));
const ordinal=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<Number.MAX_SAFE_INTEGER;
const termKeys=['schema','scope','worldId','eventId','receiptId','receiptDigest','sourceRef','priorGrantVersion','allow'] as const;
export interface PrivateNativeMealDecision extends ValleySpiritLifeGrantDecision {
 schema:typeof schema;scope:string;eventId:string;receiptId:string;
}
function eventId(v:unknown,worldId:string):v is string{
 const prefix=worldId+':event:';
 return typeof v==='string'&&v.startsWith(prefix)&&/^[1-9][0-9]{0,15}$/.test(v.slice(prefix.length));
}
export function encodePrivateNativeMealDecision(u:unknown):Buffer|null{
 if(!exact(u,termKeys)||u.schema!==schema||!hex(u.scope)||!world(u.worldId)||!eventId(u.eventId,u.worldId)||
    !uuid(u.receiptId)||!hex(u.receiptDigest)||typeof u.sourceRef!=='string'||
    !u.sourceRef.startsWith(u.worldId+'/life-')||!hex(u.sourceRef.slice(u.worldId.length+6))||
    !ordinal(u.priorGrantVersion)||typeof u.allow!=='boolean')return null;
 return Buffer.from(JSON.stringify(['native-meal-v2-private-fixed-render-v1',...termKeys.map(k=>u[k])]));
}
function signed(input:unknown,key:KeyObject):PrivateNativeMealDecision|null{
 if(!exact(input,['terms','signature'])||typeof input.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(input.signature))return null;
 const bytes=encodePrivateNativeMealDecision(input.terms),s=Buffer.from(input.signature,'base64url');
 return bytes&&s.length===64&&s.toString('base64url')===input.signature&&verify(null,bytes,key,s)?input.terms as PrivateNativeMealDecision:null;
}
/** Explicit developer capability, not the ordinary life view. It owns the
 * existing fixture lease and therefore cannot run alongside the producer. */
export function openPrivateReviewedNativeMeal(fixture:DeveloperMvpSpiritFixtureKey,pin:string){
 const owner=acquireDeveloperMvpSpiritFixtureOwner(fixture);
 let db:DatabaseSync|undefined;
 try{
  const worldId=owner.rulesMealWorldId;
  if(!worldId||!eventId(pin,worldId)||!owner.rulesMealReviewerKeyPem)throw Error('native_meal_review_scope');
  const key=createPublicKey(owner.rulesMealReviewerKeyPem);
  if(key.asymmetricKeyType!=='ed25519')throw Error('native_meal_review_key');
  const scope=hash('private-meal-fixture/v1\0'+owner.seal);
  const read=db=new DatabaseSync(owner.database,{readOnly:true});
  read.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
  let closed=false,failed=false;
  const current=()=>{
   owner.assertOwned();
   const seal=read.prepare('SELECT * FROM mvp_spirit_developer_fixture LIMIT 2').all();
   if(seal.length!==1||Object.keys(seal[0]).length!==2||seal[0].version!==1||seal[0].seal!==owner.seal)
    throw Error('native_meal_review_seal');
   const h=readNativeValidationWeatherHead(read,worldId);
   return h?{worldId,asOfUs:h.atUs}:null;
  };
  const byEvent=()=>readNativeMvpMealV2Receipt(read,worldId,pin);
  const exactReceipt=(r:Readonly<ValleySpiritLifeReceipt>)=>{
   const current=byEvent();
   return !!current&&r.schemaVersion===current.schemaVersion&&r.worldId===current.worldId&&r.receiptId===current.receiptId&&
    r.receiptVersion===current.receiptVersion&&r.atUs===current.atUs&&r.kind===current.kind;
  };
  const authority=valleySpiritLifeAuthorityOnConnection(read,worldId,owner.assertOwned,current,exactReceipt);
  const renderer=new ValleySpiritLifeAlmanac(authority,'grounded-public-life-dev');
  const make=(receipt:ValleySpiritLifeReceipt,priorGrantVersion:number,allow:boolean):PrivateNativeMealDecision=>({
   schema,scope,worldId,eventId:pin,receiptId:receipt.receiptId,...valleySpiritLifeBinding(receipt),priorGrantVersion,allow});
  const check=(input:unknown)=>{
   try{
    const t=signed(structuredClone(input),key),r=t&&byEvent();
    return t&&r&&encodePrivateNativeMealDecision(t)?.equals(encodePrivateNativeMealDecision(make(r,t.priorGrantVersion,t.allow))!)?
      {terms:t,receipt:r}:null;
   }catch{return null;}
  };
  const readTx=<T>(fn:()=>T):T|null=>{
   if(closed||failed)return null;
   let tx=false;
   try{
    owner.assertOwned();read.exec('BEGIN');tx=true;
    if(!current())throw Error('native_meal_review_world');
    const answer=fn();owner.assertOwned();read.exec('COMMIT');tx=false;return answer;
   }catch{
    failed=true;
    if(tx)try{read.exec('ROLLBACK');}catch{/* isolated */}
    return null;
   }
  };
  return Object.freeze({
   terms(priorGrantVersion:number,allow:boolean){
    if(!ordinal(priorGrantVersion)||typeof allow!=='boolean')return null;
    return readTx(()=>{const r=byEvent();return r?Object.freeze(make(r,priorGrantVersion,allow)):null;});
   },
   /** Only the independently signed exact event may enter the existing life
    * grant store. No automatic grant, generic publisher or rendered input. */
   record(input:unknown):boolean{
    let envelope:unknown;try{envelope=structuredClone(input);}catch{return false;}
    const accepted=readTx(()=>check(envelope));if(!accepted)return false;
    const {terms:t,receipt}=accepted,decision:ValleySpiritLifeGrantDecision={worldId,sourceRef:t.sourceRef,
     receiptDigest:t.receiptDigest,priorGrantVersion:t.priorGrantVersion,allow:t.allow};
    let store:SqliteValleySpiritLifeStore|undefined;
    try{
     store=new SqliteValleySpiritLifeStore(owner.database,worldId,owner.assertOwned,current,{verifyCommitted:exactReceipt,
      verifyApproval:d=>JSON.stringify(d)===JSON.stringify(decision)&&check(envelope)!==null});
     if(t.allow)store.recordCommitted(receipt);
     return store.setPublic(decision);
    }catch{return false;}finally{store?.close();}
   },
   /** Detached signature must still authorize the current exact grant epoch.
    * Output omits receipt identities, event IDs, signature, and source links. */
   read(input:unknown){
    return readTx(()=>{
     const trusted=check(input);if(!trusted?.terms.allow)return null;
     const {terms:t,receipt:r}=trusted;
     const packet=renderer.prepare(worldId,{fromUs:r.atUs,throughUs:r.atUs},[t.sourceRef]);
     if(packet?.source.facts[0]?.grantVersion!==t.priorGrantVersion+1)return null;
     const section=renderer.ground(packet,{indices:[1],wording:'time-first'});
     const line=section?.lines[0];
     return line?Object.freeze({schemaVersion:1 as const,mode:'private-reviewed-native-meal' as const,
      worldId,atUs:line.atUs,kind:line.kind,text:line.text}):null;
    });
   },
   close(){if(!closed){closed=true;try{read.close();}finally{owner.release();}}}
  });
 }catch(e){try{db?.close();}finally{owner.release();}throw e;}
}
