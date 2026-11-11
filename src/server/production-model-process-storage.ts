/** Linux-only synthetic run directory. Not an OS sandbox or protection from
 * malicious same-user replacement. No real save path or live marker accepted. */
import {constants as F,openSync,closeSync,mkdirSync,fsyncSync,fstatSync,readFileSync,writeSync} from 'node:fs';
import {isAbsolute,relative} from 'node:path';
const flags=F.O_RDONLY|F.O_DIRECTORY|F.O_NOFOLLOW;
const leaf=(s:string)=>{if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s)||['runtime','secrets','.git'].includes(s)||s.startsWith('.env'))throw Error('unsafe_process_path');return s;};
export const SYNTHETIC_PROCESS_MARKER='synthetic-price-process-v1';
export class SyntheticProcessDirectory{
 private constructor(private fd:number){}
 static open(root:string,path:string,create:boolean){
  const rel=relative(root+'/output',path);
  if(process.platform!=='linux'||!isAbsolute(path)||!rel||rel.startsWith('..')||isAbsolute(rel)||path.includes('\0'))throw Error('synthetic_repository_output_required');
  const parts=path.split('/').slice(1);parts.forEach(leaf);let fd=openSync('/',flags);
  try{for(const [i,p] of parts.entries()){
   const next=`/proc/self/fd/${fd}/${p}`;if(create&&i===parts.length-1){mkdirSync(next,{mode:0o700});fsyncSync(fd);}
   const opened=openSync(next,flags);closeSync(fd);fd=opened;
  }const info=fstatSync(fd);if(info.uid!==process.getuid?.()||(info.mode&0o777)!==0o700)throw Error('private_process_directory_required');
   const d=new SyntheticProcessDirectory(fd);fd=-1;
   if(!create)try{if((d.readJson('manifest.json') as {kind?:unknown})?.kind!==SYNTHETIC_PROCESS_MARKER)throw Error();}catch{d.close();throw Error('synthetic_process_marker_required');}
   return d;
  }finally{if(fd>=0)closeSync(fd);}
 }
 static inherit(fd:number){const info=fstatSync(fd);if(!info.isDirectory()||info.uid!==process.getuid?.()||(info.mode&0o777)!==0o700)throw Error('private_process_directory_required');
  const d=new SyntheticProcessDirectory(openSync(`/proc/self/fd/${fd}`,F.O_RDONLY|F.O_DIRECTORY));
  try{if((d.readJson('manifest.json') as {kind?:unknown})?.kind!==SYNTHETIC_PROCESS_MARKER)throw Error();return d;}catch{d.close();throw Error('synthetic_process_marker_required');}}
 descriptor(){if(this.fd<0)throw Error('process_directory_closed');return this.fd;}
 path(name:string){return `/proc/self/fd/${this.descriptor()}/${leaf(name)}`;}
 writeJson(name:string,value:unknown){const fd=openSync(this.path(name),F.O_WRONLY|F.O_CREAT|F.O_EXCL|F.O_NOFOLLOW,0o600),bytes=Buffer.from(JSON.stringify(value)+'\n');
  try{let offset=0;while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset);if(n<1)throw Error('process_short_write');offset+=n;}fsyncSync(fd);fsyncSync(this.descriptor());}finally{closeSync(fd);}}
 readJson(name:string):unknown{const fd=openSync(this.path(name),F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK);
  try{const st=fstatSync(fd);if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||st.size>1_048_576)throw Error('unsafe_process_record');
   const bytes=readFileSync(fd);if(bytes.length!==st.size)throw Error('changed_process_record');return JSON.parse(bytes.toString('utf8'));}finally{closeSync(fd);}}
 database(name:'launch.sqlite'|'world.sqlite'|'model.sqlite'|'session.sqlite',create=false){
  if(!['launch.sqlite','world.sqlite','model.sqlite','session.sqlite'].includes(name))throw Error('unsafe_process_database');
  if(create){const fd=openSync(this.path(name),F.O_RDWR|F.O_CREAT|F.O_EXCL|F.O_NOFOLLOW,0o600);try{fsyncSync(fd);fsyncSync(this.descriptor());}finally{closeSync(fd);}}
  for(const suffix of ['', '-wal','-shm','-journal']){let fd:number;try{fd=openSync(this.path(name+suffix),F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK);}catch(e){if(suffix&&(e as NodeJS.ErrnoException).code==='ENOENT')continue;throw Error('unsafe_process_database');}
   try{const st=fstatSync(fd);if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||st.size>536_870_912)throw Error('unsafe_process_database');}finally{closeSync(fd);}}
  return this.path(name);
 }
 close(){if(this.fd>=0){closeSync(this.fd);this.fd=-1;}}
}
