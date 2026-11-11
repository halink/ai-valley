// Bounded in-memory key transfer between our own child processes. Never logs it.
import {createReadStream} from 'node:fs';
export function readPrivatePipe(fd){
 return new Promise((resolve,reject)=>{
  const stream=createReadStream(null,{fd,autoClose:true});let bytes=0,chunks=[],settled=false;
  const finish=(key,error)=>{if(settled)return;settled=true;clearTimeout(timer);stream.destroy();chunks=[];error?reject(new Error('private_pipe_failed')):resolve(key);};
  const timer=setTimeout(()=>finish(null,true),5000);
  stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024)finish(null,true);else chunks.push(chunk);});
  stream.once('error',()=>finish(null,true));stream.once('end',()=>{
   const key=Buffer.concat(chunks).toString('utf8');if(!/^[A-Za-z0-9._-]{20,512}$/.test(key))finish(null,true);else finish(key,false);
  });
 });
}
