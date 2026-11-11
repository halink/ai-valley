/** Linux descriptor-anchored storage for the opt-in isolated runner. No save is
 * opened on import. Targets are capabilities, not caller-supplied /proc paths. */
import {constants,openSync,closeSync,mkdirSync,fsyncSync,fstatSync,writeSync,readFileSync,readdirSync} from 'node:fs';
import {isAbsolute} from 'node:path';
const directoryFlags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW;
const leaf=(name:string)=>{
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)||['runtime','secrets','.git'].includes(name)||name.startsWith('.env'))throw new Error('unsafe_acceptance_path');
 return name;
};
const bridge=(fd:number,name:string)=>`/proc/self/fd/${fd}/${leaf(name)}`;
function openDirectory(path:string,create:boolean){
 if(process.platform!=='linux'||!constants.O_NOFOLLOW||!isAbsolute(path)||path.includes('\0'))throw new Error('unsafe_acceptance_path');
 const parts=path.split('/').slice(1);parts.forEach(leaf);let fd=openSync('/',directoryFlags);
 try{
  for(const [i,part] of parts.entries()){
   if(create&&i===parts.length-1){mkdirSync(bridge(fd,part),{mode:0o700});fsyncSync(fd);}
   const next=openSync(bridge(fd,part),directoryFlags);closeSync(fd);fd=next;
  }
  return fd;
 }catch{closeSync(fd);throw new Error(create?'new_acceptance_directory_required':'unsafe_acceptance_directory');}
}
export class AcceptanceDirectoryTarget{
 constructor(private readonly parent:AcceptanceRunDirectory,private readonly name:string){leaf(name);}
 open(create:boolean){
  const path=this.parent.path(this.name);
  if(create){mkdirSync(path,{mode:0o700});fsyncSync(this.parent.descriptor());}
  return openSync(path,directoryFlags);
 }
}
export class AcceptanceRunDirectory{
 private constructor(private fd:number){}
 static create(path:string){return new AcceptanceRunDirectory(openDirectory(path,true));}
 /** Only the dedicated OFFLINE resumable protocol may reopen its own synthetic
  * directory. This does not extend the live probe's new-directory-only CLI. */
 static openOfflineResume(path:string){
  const fd=openDirectory(path,false);let directory:AcceptanceRunDirectory|undefined;
  try{directory=AcceptanceRunDirectory.inherit(fd);
   const marker=directory.readJson('resumable-manifest.json') as any;
   if(marker?.protocol?.protocol!=='nine-resumable-offline-v1'||marker?.protocol?.executionKind!=='offline-resumable-rehearsal'
    ||marker?.protocol?.liveExecutionEnabled!==false||marker?.protocol?.realModelExecuted!==false)throw new Error('offline_resume_marker_required');
   return directory;
  }catch{directory?.close();throw new Error('offline_resume_marker_required');}finally{closeSync(fd);}
 }
 /** Validate pre-existing SQLite files and sidecars before native SQLite opens
  * them. The private directory is trusted against same-user concurrent mutation. */
 database(name:string,create=false){
  if(!['world.sqlite','resumable.sqlite','owner.sqlite','launcher.sqlite'].includes(name))throw new Error('unsafe_acceptance_database');
  if(create){const fd=this.createFile(name);try{fsyncSync(fd);fsyncSync(this.descriptor());}finally{closeSync(fd);}}
  for(const suffix of ['', '-wal','-shm','-journal']){
   let fd:number;
   try{fd=openSync(this.path(name+suffix),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
   catch(error){if(suffix&&(error as NodeJS.ErrnoException).code==='ENOENT')continue;throw new Error('unsafe_acceptance_database');}
   try{const info=fstatSync(fd);if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||info.size>512*1024*1024)throw new Error('unsafe_acceptance_database');}finally{closeSync(fd);}
  }
  return this.path(name);
 }
 /** Internal child bootstrap only: descriptor inherited directly from guardian.
  * No CLI accepts an FD, existing directory, database, or resume path. */
 static inherit(fd:number){
  const info=fstatSync(fd);
  if(!info.isDirectory()||(info.mode&0o777)!==0o700||info.uid!==process.getuid?.())throw new Error('private_acceptance_directory_required');
  return new AcceptanceRunDirectory(openSync(`/proc/self/fd/${fd}`,constants.O_RDONLY|constants.O_DIRECTORY));
 }
 descriptor(){if(this.fd<0)throw new Error('acceptance_directory_closed');return this.fd;}
 path(name:string){return bridge(this.descriptor(),name);}
 child(name:string){return new AcceptanceDirectoryTarget(this,name);}
 createFile(name:string){return openSync(this.path(name),constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);}
 reserveDatabase(){const fd=this.createFile('world.sqlite');try{fsyncSync(fd);fsyncSync(this.descriptor());}finally{closeSync(fd);}return this.path('world.sqlite');}
 writeJson(name:string,value:unknown){
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=this.createFile(name);
  try{let offset=0;while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset);if(n<=0)throw new Error('acceptance_short_write');offset+=n;}fsyncSync(fd);fsyncSync(this.descriptor());}
  finally{closeSync(fd);}
 }
 readJson(name:string):unknown{
  const fd=openSync(this.path(name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const info=fstatSync(fd);if(!info.isFile()||info.nlink!==1||info.size>1024*1024)throw new Error('unsafe_acceptance_record');
   const bytes=readFileSync(fd);if(bytes.length!==info.size)throw new Error('changed_acceptance_record');return JSON.parse(bytes.toString('utf8'));
  }finally{closeSync(fd);}
 }
 close(){if(this.fd>=0){closeSync(this.fd);this.fd=-1;}}
}
/** Fingerprint only allowlisted code/configuration. Never enumerate the repo's
 * runtime, environment files, Git internals, or any caller-selected save. */
export function acceptanceSourceFiles(root:string){
 const fd=openDirectory(root,false),entries:Array<{path:string;bytes:Buffer}>=[];
 const collect=(parent:number,name:string,relative:string)=>{
  const file=openSync(bridge(parent,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const stat=fstatSync(file);
   if(stat.isDirectory())for(const entry of readdirSync(`/proc/self/fd/${file}`).sort())collect(file,entry,relative+'/'+entry);
   else if(stat.isFile()&&stat.nlink===1&&stat.size<=16*1024*1024){
    if(/\.(ts|css|json|mjs)$/.test(name))entries.push({path:relative,bytes:readFileSync(file)});
   }else throw new Error('unsafe_acceptance_source');
  }finally{closeSync(file);}
 };
 try{for(const name of ['src','scripts','package.json','package-lock.json','tsconfig.json','tsconfig.server.json'])collect(fd,name,name);}
 finally{closeSync(fd);}
 return entries.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
