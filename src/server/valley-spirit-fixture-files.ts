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
const formalShadowShape='valley-spirit-private-formal-fixture/v2';
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
 readonly schema:typeof shape|typeof formalShape|typeof formalShadowShape;
 readonly approvalKeyPem?:string;
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
function createKey(capacity:MvpGroundFruitCapacity,approvalKeyPem?:string,shadowKeyPem?:string):DeveloperMvpSpiritFixtureKey {
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
 const manifest:Manifest={schema:shadowKeyPem?formalShadowShape:approvalKeyPem?formalShape:shape,directoryIdentity:identity(initial),databaseIdentity,tokenHash:digest(token),capacity:{...capacity},...(approvalKeyPem?{approvalKeyPem}:{}),...(shadowKeyPem?{shadowKeyPem}:{})};
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
   ...(manifest.approvalKeyPem?{formalApprovalKeyPem:manifest.approvalKeyPem}:{}),
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
