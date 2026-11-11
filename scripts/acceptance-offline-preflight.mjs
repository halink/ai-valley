// Metadata-only source check BEFORE loading tsx or application modules. Never
// follow a source symlink first and then reject it in the later fingerprint.
import {constants,openSync,closeSync,fstatSync,readdirSync} from 'node:fs';
const flags=constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
const safe=name=>{
 if(!name||name==='.'||name==='..'||name.includes('/')||['runtime','secrets','.git'].includes(name)||name.startsWith('.env'))throw new Error('unsafe_offline_source');
 return name;
};
export function assertOfflineSourceTree(root){
 if(process.platform!=='linux'||typeof root!=='string'||!root.startsWith('/'))throw new Error('unsupported_offline_source');
 let fd=openSync('/',flags|constants.O_DIRECTORY);
 try{
  for(const name of root.split('/').slice(1)){
   const next=openSync(`/proc/self/fd/${fd}/${safe(name)}`,flags|constants.O_DIRECTORY);closeSync(fd);fd=next;
  }
  const walk=(parent,name)=>{
   const file=openSync(`/proc/self/fd/${parent}/${safe(name)}`,flags);
   try{const info=fstatSync(file);
    if(info.isDirectory())for(const entry of readdirSync(`/proc/self/fd/${file}`))walk(file,entry);
    else if(!info.isFile()||info.nlink!==1||info.size>16*1024*1024)throw new Error('unsafe_offline_source');
   }finally{closeSync(file);}
  };
  for(const name of ['src','scripts','package.json','package-lock.json','tsconfig.json','tsconfig.server.json'])walk(fd,name);
 }finally{closeSync(fd);}
}
