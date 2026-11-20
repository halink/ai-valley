/** Explicit local preview only. Not imported by any runtime entrypoint. */
import {closeSync,constants,fstatSync,lstatSync,openSync,readSync} from 'node:fs';
import {resolve} from 'node:path';
import {encodeOrdinaryOfflineWeatherReview,openOrdinaryOfflineWeatherRelease} from './valley-spirit-ordinary-weather-release.js';

const USAGE='npm --silent run dev:weather-editorial:preview -- --save PATH --world ID --from MINUTE --through MINUTE --source REF [--source REF ...] --reviewer-public-key PEM_FILE';
const keys=new Set(['--save','--world','--from','--through','--source','--reviewer-public-key']);
const MAX=24;
const worldPattern=/^godot-mvp-[A-Za-z0-9_-]{1,160}$/;
const number=(s:string|undefined)=>{
 if(!s||!/^\d{1,10}$/.test(s)||!Number.isSafeInteger(Number(s)))throw Error('invalid-minute');
 return Number(s);
};
function input(args:readonly string[]){
 if(args.length<12||args.length>2*(MAX+5)||args.length%2!==0)throw Error('invalid-options');
 const fields=new Map<string,string>(),sources=new Set<string>();
 for(let i=0;i<args.length;i+=2){
  const key=args[i],val=args[i+1];
  if(!keys.has(key)||!val||val.startsWith('--')||val.length>4096||val.includes('\0'))throw Error('invalid-option');
  if(key==='--source'){
   if(sources.has(val)||sources.size===MAX)throw Error('invalid-sources');
   sources.add(val);
  }else{
   if(fields.has(key))throw Error('duplicate-option');
   fields.set(key,val);
  }
 }
 const save=fields.get('--save'),worldId=fields.get('--world'),keyFile=fields.get('--reviewer-public-key');
 if(!save||!keyFile||!worldId||!worldPattern.test(worldId)||!sources.size)throw Error('missing-or-invalid-option');
 const range={fromMinute:number(fields.get('--from')),throughMinute:number(fields.get('--through')),sourceRefs:[...sources]};
 if(range.fromMinute>range.throughMinute||range.throughMinute-range.fromMinute>=MAX*60||
    range.sourceRefs.some(s=>!s.startsWith(worldId+'/')||!/^weather-[1-9]\d{0,9}-(?:0|[1-9]\d{0,9})$/.test(s.slice(worldId.length+1))))
  throw Error('invalid-range-or-source');
 return {path:resolve(save),worldId,range,keyFile:resolve(keyFile)};
}
function readPublicKey(path:string){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const stat=fstatSync(fd),current=lstatSync(path);
  if(!stat.isFile()||stat.dev!==current.dev||stat.ino!==current.ino||stat.size<1||stat.size>256)throw Error('invalid-reviewer-public-key-file');
  const bytes=Buffer.alloc(257),size=readSync(fd,bytes,0,bytes.length,0);
  if(size!==stat.size)throw Error('invalid-reviewer-public-key-file');
  const pem=bytes.subarray(0,size).toString('utf8');
  if(!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(pem))throw Error('invalid-reviewer-public-key-file');
  return pem;
 }finally{closeSync(fd);}
}
function run(args:readonly string[]){
 if(args.length===1&&args[0]==='--help'){process.stdout.write(USAGE+'\n');return;}
 let parsed:ReturnType<typeof input>;
 try{parsed=input(args);}catch{
  process.stderr.write('参数无效。'+USAGE+'\n');process.exitCode=2;return;
 }
 try{
  const editor=openOrdinaryOfflineWeatherRelease({database:parsed.path,worldId:parsed.worldId,
   reviewerPublicKeyPem:readPublicKey(parsed.keyFile),previewOnly:true});
  try{
   const preview=editor.preview(parsed.range),bytes=preview&&encodeOrdinaryOfflineWeatherReview(preview.terms);
   if(!preview||!bytes)throw Error('preview-unavailable');
   process.stdout.write(JSON.stringify({mode:'local-offline-editorial-preview',terms:preview.terms,
    signingBytesBase64:bytes.toString('base64'),edition:preview.edition,range:parsed.range})+'\n');
  }finally{editor.close();}
 }catch{
  process.stderr.write('无法预览。请确认普通开发存档已停止且无遗留日志，公钥、世界、权限及来源均有效。\n');
  process.exitCode=1;
 }
}
run(process.argv.slice(2));
