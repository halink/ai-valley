import {validSealedMvpSourceAgePolicy,type SealedMvpSourceAgePolicy} from './valley-spirit-mvp-source-age.js';
import {createHash,createHmac,createPublicKey,randomBytes,timingSafeEqual} from 'node:crypto';
import {closeSync,constants,fstatSync,fsyncSync,lstatSync,mkdtempSync,openSync,readSync,realpathSync,statSync,writeFileSync,type BigIntStats} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import type {MvpGroundFruitCapacity} from '../world/mvp-ground-fruit.js';
import {validMvpSpiritFixtureCapacity} from '../world/mvp-spirit-effects.js';
import {acquireRuntimeOwnership,type RuntimeOwnership} from './runtime-lock.js';

const prefix='valley-spirit-dev-';
const manifestName='fixture-v1.json';
const databaseName='fixture.sqlite';
const shape='valley-spirit-private-developer-fixture/v1';
const formalShape='valley-spirit-private-formal-fixture/v1';
const formalWeatherShape='valley-spirit-private-formal-weather-preparation/v1';
const formalWeatherWorld=(v:unknown):v is string=>typeof v==='string'&&/^valley-formal-[A-Za-z0-9_-]{1,180}$/.test(v);
const formalShadowShape='valley-spirit-private-formal-fixture/v2';
const agedReviewShape='valley-spirit-private-aged-placement-fixture/v2';
const agedPlacementShape='valley-spirit-private-aged-placement-fixture/v1';
const sourceAgeShape='valley-spirit-private-source-age-fixture/v1';
const reviewedShape='valley-spirit-private-yearbook-review-fixture/v1';
const weatherEditorialShape='valley-spirit-private-weather-editorial-fixture/v1';
const weatherUseShape='valley-spirit-private-weather-use-fixture/v1';
const reviewedRulesMealShape='valley-spirit-private-rules-reviewed-meal-fixture/v1';
const atomicRulesMealShape='valley-spirit-private-rules-meal-fixture/v1';
const sameSaveG0Shape='valley-spirit-private-rules-g0-weather-review-fixture/v1';
const rulesAccountScope=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,126}$/.test(v);
const speechWeatherShape='valley-spirit-private-rules-speech-weather-fixture/v1';
const speechShape='valley-spirit-private-rules-speech-fixture/v1';
const speechWorld=(v:unknown):v is string=>typeof v==='string'&&/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(v);
const active=new WeakSet<DeveloperMvpSpiritFixtureOwner>();
const attached=new WeakSet<DeveloperMvpSpiritFixtureOwner>();
const digest=(token:string)=>createHash('sha256').update(token,'ascii').digest('hex');
const hex=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const identity=(s:BigIntStats)=>`${s.dev}:${s.ino}`;
const privateDirectory=(s:BigIntStats)=>s.isDirectory()&&!s.isSymbolicLink()&&s.uid===BigInt(process.getuid!())&&(s.mode&0o7777n)===0o700n;
const privateFile=(s:BigIntStats)=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&s.uid===BigInt(process.getuid!())&&(s.mode&0o077n)===0n;
const exact=(v:unknown,keys:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function invalid():never {throw Error('invalid_private_spirit_fixture');}
function root():string {
 if(process.platform!=='linux'||typeof process.getuid!=='function')return invalid();
 return realpathSync(tmpdir());
}
interface Manifest {
 readonly schema:typeof shape|typeof formalShape|typeof formalShadowShape|typeof reviewedShape|typeof sourceAgeShape|typeof weatherUseShape|typeof weatherEditorialShape|typeof agedPlacementShape|typeof agedReviewShape|typeof speechShape|typeof speechWeatherShape|typeof sameSaveG0Shape|typeof atomicRulesMealShape|typeof reviewedRulesMealShape|typeof formalWeatherShape;
 readonly approvalKeyPem?:string;
 readonly yearbookReviewerKeyPem?:string;
 readonly rulesSpeechWorldId?:string;
 readonly rulesMealWorldId?:string;
 readonly rulesMealReviewerKeyPem?:string;
 readonly rulesWeatherHourCredit?:true;
 readonly formalWeatherPurpose?:Readonly<{worldId:string;keyPem:string}>;
 readonly rulesWeatherAccountScope?:string;
 readonly weatherUse?:Readonly<{keyPem:string;accountFingerprint:string;editorialKeyPem?:string}>;
 readonly sourceAge?:Readonly<{keyPem:string;policy:SealedMvpSourceAgePolicy}>;
 readonly agedPlacementKeyPem?:string;
 readonly agedG1ReviewerKeyPem?:string;
 readonly shadowKeyPem?:string;
 readonly directoryIdentity:string;
 readonly databaseIdentity:string;
 readonly tokenHash:string;
 readonly capacity:MvpGroundFruitCapacity;
}
export interface DeveloperMvpSpiritFixtureKey {
 readonly directory:string;
 /** Private restart capability. Never include it in public views or diagnostics. */
 readonly token:string;
}
export interface DeveloperMvpSpiritFixtureOwner {
 readonly database:string;
 readonly formalApprovalKeyPem?:string;
 readonly yearbookReviewerKeyPem?:string;
 readonly rulesSpeechWorldId?:string;
 readonly rulesMealWorldId?:string;
 readonly rulesMealReviewerKeyPem?:string;
 readonly rulesWeatherHourCredit?:true;
 readonly formalWeatherPurpose?:Readonly<{worldId:string;keyPem:string}>;
 readonly rulesWeatherAccountScope?:string;
 readonly weatherUse?:Readonly<{keyPem:string;accountFingerprint:string;editorialKeyPem?:string}>;
 readonly sourceAge?:Readonly<{keyPem:string;policy:SealedMvpSourceAgePolicy}>;
 readonly agedPlacementKeyPem?:string;
 readonly agedG1ReviewerKeyPem?:string;
 readonly formalShadowKeyPem?:string;
 readonly seal:string;
 readonly capacity:MvpGroundFruitCapacity;
 assertOwned():void;
 release():void;
}
export function isDeveloperMvpSpiritFixtureOwner(value:unknown):value is DeveloperMvpSpiritFixtureOwner {
 return !!value&&typeof value==='object'&&active.has(value as DeveloperMvpSpiritFixtureOwner);
}
export function claimDeveloperMvpSpiritFixtureOwner(owner:DeveloperMvpSpiritFixtureOwner):void {
 if(!isDeveloperMvpSpiritFixtureOwner(owner)||attached.has(owner))return invalid();
 owner.assertOwned();attached.add(owner);
}
function formalApprovalKey(pem:unknown):pem is string {
 try{return typeof pem==='string'&&pem.length<=256&&
  /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(pem)&&createPublicKey(pem).asymmetricKeyType==='ed25519';}
 catch{return false;}
}
export function createDeveloperMvpSpiritFixtureKey(capacity:MvpGroundFruitCapacity):DeveloperMvpSpiritFixtureKey {
 return createKey(capacity);
}
export function createDeveloperFormalBerryFixtureKey(capacity:MvpGroundFruitCapacity,approvalKeyPem:string):DeveloperMvpSpiritFixtureKey {
 if(!formalApprovalKey(approvalKeyPem)||capacity.worldLots<1||capacity.lotsPerTarget<1)return invalid();
 return createKey(capacity,approvalKeyPem);
}
function independentKeys(a:string,b:unknown):b is string {
 return formalApprovalKey(a)&&formalApprovalKey(b)&&!createPublicKey(a).export({type:'spki',format:'der'})
  .equals(createPublicKey(b).export({type:'spki',format:'der'}));
}
export function createDeveloperFormalShadowFixtureKey(
 capacity:MvpGroundFruitCapacity,approvalKeyPem:string,shadowKeyPem:string,
):DeveloperMvpSpiritFixtureKey{
 if(!independentKeys(approvalKeyPem,shadowKeyPem)||capacity.worldLots<1||capacity.lotsPerTarget<1)return invalid();
 return createKey(capacity,approvalKeyPem,shadowKeyPem);
}
export function createDeveloperReviewedYearbookFixtureKey(capacity:MvpGroundFruitCapacity,reviewerKeyPem:string):DeveloperMvpSpiritFixtureKey {
 if(!formalApprovalKey(reviewerKeyPem))return invalid();
 return createKey(capacity,undefined,undefined,reviewerKeyPem);
}
export function createDeveloperMvpSourceAgeFixtureKey(
 capacity:MvpGroundFruitCapacity,keyPem:string,policy:SealedMvpSourceAgePolicy,
):DeveloperMvpSpiritFixtureKey {
 if(!formalApprovalKey(keyPem)||!validSealedMvpSourceAgePolicy(policy))return invalid();
 return createKey(capacity,undefined,undefined,undefined,{keyPem,policy:{...policy}});
}
export function createDeveloperWeatherUseFixtureKey(capacity:MvpGroundFruitCapacity,keyPem:string,accountFingerprint:string):DeveloperMvpSpiritFixtureKey {
 if(!formalApprovalKey(keyPem)||!hex(accountFingerprint))return invalid();
 return createKey(capacity,undefined,undefined,undefined,undefined,{keyPem,accountFingerprint});
}
export function createDeveloperWeatherEditorialFixtureKey(capacity:MvpGroundFruitCapacity,sendKeyPem:string,
 editorialKeyPem:string,accountFingerprint:string):DeveloperMvpSpiritFixtureKey {
 if(!independentKeys(sendKeyPem,editorialKeyPem)||!hex(accountFingerprint))return invalid();
 return createKey(capacity,undefined,undefined,undefined,undefined,{keyPem:sendKeyPem,accountFingerprint,editorialKeyPem});
}
export function createDeveloperMvpAgedPlacementFixtureKey(
 capacity:MvpGroundFruitCapacity,ageKeyPem:string,policy:SealedMvpSourceAgePolicy,effectKeyPem:string,
):DeveloperMvpSpiritFixtureKey {
 if(!independentKeys(ageKeyPem,effectKeyPem)||!validSealedMvpSourceAgePolicy(policy)||
  capacity.worldLots<1||capacity.lotsPerTarget<1)return invalid();
 return createKey(capacity,undefined,undefined,undefined,{keyPem:ageKeyPem,policy:{...policy}},undefined,effectKeyPem);
}
export function createDeveloperMvpAgedReviewFixtureKey(
 capacity:MvpGroundFruitCapacity,ageKeyPem:string,policy:SealedMvpSourceAgePolicy,effectKeyPem:string,reviewerKeyPem:string,
):DeveloperMvpSpiritFixtureKey {
 if(!independentKeys(ageKeyPem,effectKeyPem)||!independentKeys(ageKeyPem,reviewerKeyPem)||
  !independentKeys(effectKeyPem,reviewerKeyPem)||!validSealedMvpSourceAgePolicy(policy)||
  capacity.worldLots<1||capacity.lotsPerTarget<1)return invalid();
 return createKey(capacity,undefined,undefined,undefined,{keyPem:ageKeyPem,policy:{...policy}},undefined,effectKeyPem,reviewerKeyPem);
}
export function createDeveloperRulesSpeechFixtureKey(worldId:string):DeveloperMvpSpiritFixtureKey {
 if(!speechWorld(worldId))return invalid();
 return createKey({worldLots:0,lotsPerTarget:0},undefined,undefined,undefined,undefined,undefined,undefined,undefined,worldId);
}
export function createDeveloperRulesSpeechWeatherFixtureKey(worldId:string):DeveloperMvpSpiritFixtureKey {
 if(!speechWorld(worldId))return invalid();
 return createKey({worldLots:0,lotsPerTarget:0},undefined,undefined,undefined,undefined,undefined,undefined,undefined,worldId,true);
}
export function createDeveloperSameSaveG0FixtureKey(worldId:string,accountScope:string,accountFingerprint:string,
 sendKeyPem:string,editorialKeyPem:string):DeveloperMvpSpiritFixtureKey {
 if(!speechWorld(worldId)||!rulesAccountScope(accountScope)||!hex(accountFingerprint)||!independentKeys(sendKeyPem,editorialKeyPem))return invalid();
 return createKey({worldLots:0,lotsPerTarget:0},undefined,undefined,undefined,undefined,
  {keyPem:sendKeyPem,accountFingerprint,editorialKeyPem},undefined,undefined,worldId,true,accountScope);
}
export function createDeveloperRulesMealFixtureKey(worldId:string):DeveloperMvpSpiritFixtureKey {
 if(!speechWorld(worldId))return invalid();
 return createKey({worldLots:0,lotsPerTarget:0},undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,worldId);
}
export function createDeveloperRulesReviewedMealFixtureKey(worldId:string,reviewerKeyPem:string):DeveloperMvpSpiritFixtureKey {
 if(!speechWorld(worldId)||!formalApprovalKey(reviewerKeyPem))return invalid();
 return createKey({worldLots:0,lotsPerTarget:0},undefined,undefined,undefined,undefined,undefined,undefined,undefined,
  undefined,undefined,undefined,worldId,reviewerKeyPem);
}
export function createDeveloperFormalWeatherPreparationFixtureKey(worldId:string,keyPem:string):DeveloperMvpSpiritFixtureKey{
 if(!formalWeatherWorld(worldId)||!formalApprovalKey(keyPem))return invalid();
 return createKey({worldLots:0,lotsPerTarget:0},undefined,undefined,undefined,undefined,undefined,undefined,undefined,
  undefined,undefined,undefined,undefined,undefined,{worldId,keyPem});
}
function createKey(capacity:MvpGroundFruitCapacity,approvalKeyPem?:string,shadowKeyPem?:string,yearbookReviewerKeyPem?:string,sourceAge?:Manifest['sourceAge'],weatherUse?:Manifest['weatherUse'],agedPlacementKeyPem?:string,agedG1ReviewerKeyPem?:string,rulesSpeechWorldId?:string,rulesWeatherHourCredit?:true,rulesWeatherAccountScope?:string,rulesMealWorldId?:string,rulesMealReviewerKeyPem?:string,formalWeatherPurpose?:Manifest['formalWeatherPurpose']):DeveloperMvpSpiritFixtureKey {
 if(!validMvpSpiritFixtureCapacity(capacity))return invalid();
 const directory=mkdtempSync(join(root(),prefix));
 const initial=lstatSync(directory,{bigint:true});if(!privateDirectory(initial))return invalid();
 const token=randomBytes(32).toString('hex');
 const fd=openSync(join(directory,databaseName),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 let databaseIdentity:string;
 try{
  const s=fstatSync(fd,{bigint:true});if(!privateFile(s)||s.size!==0n)return invalid();
  databaseIdentity=identity(s);fsyncSync(fd);
 }finally{closeSync(fd);}
 const manifest:Manifest={schema:formalWeatherPurpose?formalWeatherShape:rulesMealReviewerKeyPem?reviewedRulesMealShape:rulesMealWorldId?atomicRulesMealShape:rulesWeatherAccountScope?sameSaveG0Shape:rulesWeatherHourCredit?speechWeatherShape:rulesSpeechWorldId?speechShape:agedG1ReviewerKeyPem?agedReviewShape:agedPlacementKeyPem?agedPlacementShape:weatherUse?.editorialKeyPem?weatherEditorialShape:weatherUse?weatherUseShape:sourceAge?sourceAgeShape:yearbookReviewerKeyPem?reviewedShape:shadowKeyPem?formalShadowShape:approvalKeyPem?formalShape:shape,directoryIdentity:identity(initial),databaseIdentity,tokenHash:digest(token),capacity:{...capacity},...(approvalKeyPem?{approvalKeyPem}:{}),...(shadowKeyPem?{shadowKeyPem}:{}),...(yearbookReviewerKeyPem?{yearbookReviewerKeyPem}:{}),...(sourceAge?{sourceAge}:{}),...(weatherUse?{weatherUse}:{}),...(agedPlacementKeyPem?{agedPlacementKeyPem}:{}),...(agedG1ReviewerKeyPem?{agedG1ReviewerKeyPem}:{}),...(rulesSpeechWorldId?{rulesSpeechWorldId}:{}),...(rulesWeatherHourCredit?{rulesWeatherHourCredit}:{}),...(rulesWeatherAccountScope?{rulesWeatherAccountScope}:{}),...(rulesMealWorldId?{rulesMealWorldId}:{}),...(rulesMealReviewerKeyPem?{rulesMealReviewerKeyPem}:{}),...(formalWeatherPurpose?{formalWeatherPurpose}:{})};
 const metadata=openSync(join(directory,manifestName),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{writeFileSync(metadata,JSON.stringify(manifest),'utf8');fsyncSync(metadata);}finally{closeSync(metadata);}
 const parent=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{fsyncSync(parent);}finally{closeSync(parent);}
 return Object.freeze({directory,token});
}
function readManifest(path:string):{identity:string;value:Manifest} {
 const before=lstatSync(path,{bigint:true});
 if(!privateFile(before)||before.size<1n||before.size>2048n)return invalid();
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const opened=fstatSync(fd,{bigint:true});
  if(!privateFile(opened)||identity(opened)!==identity(before)||opened.size!==before.size)return invalid();
  const bytes=Buffer.alloc(Number(opened.size)+1);
  let count=0;
  while(count<bytes.length){
   const n=readSync(fd,bytes,count,bytes.length-count,count);
   if(n===0)break;
   count+=n;
  }
  const body=bytes.subarray(0,count);
  const final=fstatSync(fd,{bigint:true});
  if(body.length!==Number(opened.size)||final.size!==opened.size||final.ctimeNs!==opened.ctimeNs||final.mtimeNs!==opened.mtimeNs)return invalid();
  let v:Manifest;
  try{v=JSON.parse(body.toString('utf8')) as Manifest;}catch{return invalid();}
  const base=['schema','directoryIdentity','databaseIdentity','tokenHash','capacity'];
  if(!(v?.schema===shape&&exact(v,base)||v?.schema===formalShape&&exact(v,[...base,'approvalKeyPem'])&&formalApprovalKey(v.approvalKeyPem)||
   v?.schema===agedPlacementShape&&exact(v,[...base,'sourceAge','agedPlacementKeyPem'])&&exact(v.sourceAge,['keyPem','policy'])&&
    independentKeys(v.sourceAge!.keyPem,v.agedPlacementKeyPem)&&validSealedMvpSourceAgePolicy(v.sourceAge!.policy)&&
    v.capacity?.worldLots>0&&v.capacity?.lotsPerTarget>0||
   v?.schema===agedReviewShape&&exact(v,[...base,'sourceAge','agedPlacementKeyPem','agedG1ReviewerKeyPem'])&&exact(v.sourceAge,['keyPem','policy'])&&
    independentKeys(v.sourceAge!.keyPem,v.agedPlacementKeyPem)&&independentKeys(v.sourceAge!.keyPem,v.agedG1ReviewerKeyPem)&&
    independentKeys(v.agedPlacementKeyPem!,v.agedG1ReviewerKeyPem)&&validSealedMvpSourceAgePolicy(v.sourceAge!.policy)&&
    v.capacity?.worldLots>0&&v.capacity?.lotsPerTarget>0||
   v?.schema===sourceAgeShape&&exact(v,[...base,'sourceAge'])&&exact(v.sourceAge,['keyPem','policy'])&&
    formalApprovalKey(v.sourceAge!.keyPem)&&validSealedMvpSourceAgePolicy(v.sourceAge!.policy)||
   v?.schema===weatherEditorialShape&&exact(v,[...base,'weatherUse'])&&exact(v.weatherUse,['keyPem','accountFingerprint','editorialKeyPem'])&&
    independentKeys(v.weatherUse!.keyPem,v.weatherUse!.editorialKeyPem)&&hex(v.weatherUse!.accountFingerprint)||
   v?.schema===formalWeatherShape&&exact(v,[...base,'formalWeatherPurpose'])&&exact(v.formalWeatherPurpose,['worldId','keyPem'])&&
    formalWeatherWorld(v.formalWeatherPurpose!.worldId)&&formalApprovalKey(v.formalWeatherPurpose!.keyPem)&&
    v.capacity?.worldLots===0&&v.capacity?.lotsPerTarget===0||
   v?.schema===reviewedRulesMealShape&&exact(v,[...base,'rulesMealWorldId','rulesMealReviewerKeyPem'])&&speechWorld(v.rulesMealWorldId)&&
    formalApprovalKey(v.rulesMealReviewerKeyPem)&&v.capacity?.worldLots===0&&v.capacity?.lotsPerTarget===0||
   v?.schema===atomicRulesMealShape&&exact(v,[...base,'rulesMealWorldId'])&&speechWorld(v.rulesMealWorldId)&&
    v.capacity?.worldLots===0&&v.capacity?.lotsPerTarget===0||
   v?.schema===sameSaveG0Shape&&exact(v,[...base,'rulesSpeechWorldId','rulesWeatherHourCredit','rulesWeatherAccountScope','weatherUse'])&&
    speechWorld(v.rulesSpeechWorldId)&&v.rulesWeatherHourCredit===true&&rulesAccountScope(v.rulesWeatherAccountScope)&&
    v.capacity?.worldLots===0&&v.capacity?.lotsPerTarget===0&&exact(v.weatherUse,['keyPem','accountFingerprint','editorialKeyPem'])&&
    independentKeys(v.weatherUse!.keyPem,v.weatherUse!.editorialKeyPem)&&hex(v.weatherUse!.accountFingerprint)||
   v?.schema===speechWeatherShape&&exact(v,[...base,'rulesSpeechWorldId','rulesWeatherHourCredit'])&&speechWorld(v.rulesSpeechWorldId)&&
    v.rulesWeatherHourCredit===true&&v.capacity?.worldLots===0&&v.capacity?.lotsPerTarget===0||
   v?.schema===speechShape&&exact(v,[...base,'rulesSpeechWorldId'])&&speechWorld(v.rulesSpeechWorldId)&&
    v.capacity?.worldLots===0&&v.capacity?.lotsPerTarget===0||
   v?.schema===weatherUseShape&&exact(v,[...base,'weatherUse'])&&exact(v.weatherUse,['keyPem','accountFingerprint'])&&
    formalApprovalKey(v.weatherUse!.keyPem)&&hex(v.weatherUse!.accountFingerprint)||
   v?.schema===reviewedShape&&exact(v,[...base,'yearbookReviewerKeyPem'])&&formalApprovalKey(v.yearbookReviewerKeyPem)||
   v?.schema===formalShadowShape&&exact(v,[...base,'approvalKeyPem','shadowKeyPem'])&&
    independentKeys(v.approvalKeyPem!,v.shadowKeyPem))||!hex(v.tokenHash)||
   typeof v.directoryIdentity!=='string'||typeof v.databaseIdentity!=='string'||
   !/^\d+:\d+$/.test(v.directoryIdentity)||!/^\d+:\d+$/.test(v.databaseIdentity)||
   !validMvpSpiritFixtureCapacity(v.capacity)||!body.equals(Buffer.from(JSON.stringify(v),'utf8')))return invalid();
  return {identity:identity(opened),value:v};
 }finally{closeSync(fd);}
}

/** Requires the opaque capability and the exact new temp directory/DB inodes.
 * No arbitrary input database path can acquire the writable fixture capability. */
export function acquireDeveloperMvpSpiritFixtureOwner(key:DeveloperMvpSpiritFixtureKey):DeveloperMvpSpiritFixtureOwner {
 const tmp=root();
 if(!exact(key,['directory','token'])||!hex(key.token)||typeof key.directory!=='string'||
  dirname(key.directory)!==tmp||key.directory!==join(tmp,basename(key.directory))||
  !/^valley-spirit-dev-[A-Za-z0-9]{6}$/.test(basename(key.directory)))return invalid();
 const directory=key.directory;
 const dir=lstatSync(directory,{bigint:true});if(!privateDirectory(dir))return invalid();
 const metadata=join(directory,manifestName),path=join(directory,databaseName);
 const {identity:manifestIdentity,value:manifest}=readManifest(metadata),manifestSnapshot=JSON.stringify(manifest);
 if(identity(dir)!==manifest.directoryIdentity||!timingSafeEqual(Buffer.from(digest(key.token),'hex'),Buffer.from(manifest.tokenHash,'hex')))return invalid();
 const initial=lstatSync(path,{bigint:true});
 if(!privateFile(initial)||identity(initial)!==manifest.databaseIdentity)return invalid();
 let ownership:RuntimeOwnership|undefined;
 try{
  ownership=acquireRuntimeOwnership(path);
  const handle=ownership,owner:DeveloperMvpSpiritFixtureOwner=Object.freeze({
   database:handle.database,seal:createHmac('sha256',key.token).update(manifestSnapshot,'utf8').digest('hex'),
   capacity:Object.freeze({...manifest.capacity}),
   ...(manifest.formalWeatherPurpose?{formalWeatherPurpose:Object.freeze({...manifest.formalWeatherPurpose})}:{}),
   ...(manifest.approvalKeyPem?{formalApprovalKeyPem:manifest.approvalKeyPem}:{}),
   ...(manifest.yearbookReviewerKeyPem?{yearbookReviewerKeyPem:manifest.yearbookReviewerKeyPem}:{}),
   ...(manifest.rulesWeatherAccountScope?{rulesWeatherAccountScope:manifest.rulesWeatherAccountScope}:{}),
   ...(manifest.rulesWeatherHourCredit?{rulesWeatherHourCredit:true as const}:{}),
   ...(manifest.rulesMealReviewerKeyPem?{rulesMealReviewerKeyPem:manifest.rulesMealReviewerKeyPem}:{}),
   ...(manifest.rulesMealWorldId?{rulesMealWorldId:manifest.rulesMealWorldId}:{}),
   ...(manifest.rulesSpeechWorldId?{rulesSpeechWorldId:manifest.rulesSpeechWorldId}:{}),
   ...(manifest.weatherUse?{weatherUse:Object.freeze({...manifest.weatherUse})}:{}),
   ...(manifest.sourceAge?{sourceAge:Object.freeze({keyPem:manifest.sourceAge.keyPem,policy:Object.freeze({...manifest.sourceAge.policy})})}:{}),
   ...(manifest.agedPlacementKeyPem?{agedPlacementKeyPem:manifest.agedPlacementKeyPem}:{}),
   ...(manifest.agedG1ReviewerKeyPem?{agedG1ReviewerKeyPem:manifest.agedG1ReviewerKeyPem}:{}),
   ...(manifest.shadowKeyPem?{formalShadowKeyPem:manifest.shadowKeyPem}:{}),
   assertOwned(){
    if(!active.has(owner))return invalid();
    handle.assertOwned();
    const parent=statSync(dirname(handle.database),{bigint:true}),current=lstatSync(handle.database,{bigint:true}),read=readManifest(metadata);
    if(!privateDirectory(parent)||identity(parent)!==manifest.directoryIdentity||!privateFile(current)||
     identity(current)!==manifest.databaseIdentity||read.identity!==manifestIdentity||JSON.stringify(read.value)!==manifestSnapshot)return invalid();
   },
   release(){if(!active.has(owner))return;handle.release();active.delete(owner);},
  });
  active.add(owner);
  try{owner.assertOwned();return owner;}catch(error){owner.release();throw error;}
 }catch(error){ownership?.release();throw error;}
}
