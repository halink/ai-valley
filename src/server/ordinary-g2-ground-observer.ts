import {spawn} from 'node:child_process';
import {realpathSync,statSync} from 'node:fs';
import {basename,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const project=fileURLToPath(new URL('../../godot-client/',import.meta.url));
const scene='res://private_ground_observer.tscn';
const envKeys=['HOME','PATH','DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR',
 'XDG_DATA_HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','LANG','LC_ALL'] as const;
type Marker=Readonly<{status:'empty'|'unavailable'}>|Readonly<{status:'active';x:number;y:number}>;

type ObserverBoot=Readonly<{binary:string;identity:string}>;
const boots=new WeakSet<ObserverBoot>();
const identity=(binary:string)=>{
 const s=statSync(binary,{bigint:true});
 return s.isFile()?[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode].join(':'):null;
};

/** The trusted original-owner bootstrap, not the observer request, pins the executable. */
export function pinOrdinaryG2GroundObserver(executable:unknown){
 if(typeof executable!=='string'||!isAbsolute(executable))return null;
 try{
 const binary=realpathSync(executable),stamp=identity(binary);
 if(!stamp||!/^godot(?:[-_.][a-zA-Z0-9_.-]+)?$/i.test(basename(binary)))return null;
 const boot=Object.freeze({binary,identity:stamp});
 boots.add(boot);
 return boot;
 }catch{return null;}
}

/** The original owner supplies a redacted read, never the archive or session. */
export function openOrdinaryG2GroundObserver(boot:ObserverBoot,read:()=>Marker){
 if(!boots.has(boot))return null;
 try{
 const {binary}=boot;
 if(realpathSync(binary)!==binary||identity(binary)!==boot.identity)return null;
 const env:NodeJS.ProcessEnv={};
 for(const k of envKeys)if(process.env[k]!==undefined)env[k]=process.env[k];
 const child=spawn(binary,['--path',project,scene],{cwd:project,env,stdio:['pipe','ignore','ignore'],windowsHide:true});
 let stopped=false;
 let timer:ReturnType<typeof setInterval>|undefined;
 const close=()=>{
  if(stopped)return;
  stopped=true;
  if(timer)clearInterval(timer);
  child.stdin.destroy();
  if(child.exitCode===null&&child.signalCode===null)try{child.kill();}catch{/* pipe closure already invalidates and ends the observer */}
 };
 child.on('error',close);
 child.once('exit',close);
 child.stdin.on('error',close);
 const refresh=()=>{
  if(stopped)return;
  try{
   const m=read();
   const line=m.status==='active'&&Number.isSafeInteger(m.x)&&Number.isSafeInteger(m.y)&&
    m.x>=0&&m.y>=0&&m.x<=65535&&m.y<=65535?`active ${m.x} ${m.y}\n`:
    (m.status==='empty'?'empty\n':'unavailable\n');
   if(!child.stdin.write(line))close();
  }catch{close();}
 };
 timer=setInterval(refresh,125);timer.unref();
 refresh();
 return Object.freeze({refresh,close,isOpen:()=>!stopped});
 }catch{return null;}
}
