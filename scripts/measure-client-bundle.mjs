import {build} from 'vite';
import {gzipSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

/** Offline build: no environment files, server, model, saved world or disk output. */
export async function measureClientBundle(){
 // Mirror the current vite.config.ts production base. Disable configuration loading
 // as well as env files so this measurement cannot execute a future config hook.
 const result=await build({root,configFile:false,envFile:false,base:'/ai-town/',logLevel:'silent',build:{write:false}});
 const outputs=(Array.isArray(result)?result:[result]).flatMap(result=>result.output);
 const chunks=outputs.filter(output=>output.type==='chunk').map(chunk=>({
  file:chunk.fileName,entry:chunk.isEntry,bytes:Buffer.byteLength(chunk.code),gzip:gzipSync(chunk.code).length,
  imports:chunk.imports,dynamicImports:chunk.dynamicImports,
  modules:Object.entries(chunk.modules).map(([id,module])=>({id:id.replace(root,''),renderedBytes:module.renderedLength})),
 }));
 const initialFiles=new Set();
 function visit(file){if(initialFiles.has(file))return;initialFiles.add(file);for(const imported of chunks.find(c=>c.file===file)?.imports??[])visit(imported);}
 for(const chunk of chunks.filter(c=>c.entry))visit(chunk.file);
 const initial=chunks.filter(c=>initialFiles.has(c.file));
 const html=outputs.find(output=>output.type==='asset'&&output.fileName==='index.html')?.source??'';
 return {chunks,initialFiles:[...initialFiles],initialBytes:initial.reduce((sum,c)=>sum+c.bytes,0),
  initialGzip:initial.reduce((sum,c)=>sum+c.gzip,0),totalBytes:chunks.reduce((sum,c)=>sum+c.bytes,0),
  totalGzip:chunks.reduce((sum,c)=>sum+c.gzip,0),html:String(html)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {chunks,html,...summary}=await measureClientBundle();
 console.log(JSON.stringify({...summary,chunks:chunks.map(({modules,...chunk})=>({...chunk,
  largestModules:modules.sort((a,b)=>b.renderedBytes-a.renderedBytes).slice(0,12)}))},null,2));
}
