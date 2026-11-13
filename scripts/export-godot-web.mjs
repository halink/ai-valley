import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync,unlinkSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const cwd=fileURLToPath(new URL('../',import.meta.url)),out=join(cwd,'output/godot-web'),ready=join(out,'.ready');
mkdirSync(out,{recursive:true});
if(existsSync(ready))unlinkSync(ready); // Never present stale exports after a failed rebuild.
const env={PATH:process.env.PATH??'',LANG:'C.UTF-8',GODOT_SILENCE_ROOT_WARNING:'1'};
for(const key of ['HOME','XDG_DATA_HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','SystemRoot','WINDIR'])if(process.env[key])env[key]=process.env[key];
function run(args){
 const result=spawnSync('godot',args,{cwd,env,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
 const output=(result.stdout??'')+(result.stderr??'');process.stdout.write(output);
 if(result.error||result.status!==0||/(?:SCRIPT ERROR:|ERROR:|Assertion failed)/i.test(output))throw Error('Godot import/export failed; no usable Web build recorded');
 return output;
}
try{
 if(!/^4\.6\.3\.stable(?:\.|$)/m.test(run(['--version'])))throw Error('Godot 4.6.3 stable required');
 run(['--headless','--editor','--path','godot-client','--import']);
 run(['--headless','--path','godot-client','--export-release','Web']);
 for(const name of ['index.html','index.js','index.wasm','index.pck'])if(!statSync(join(out,name)).isFile()||statSync(join(out,name)).size===0)throw Error('Missing export artifact '+name);
 if(!readFileSync(join(out,'index.html'),'utf8').includes('index.js'))throw Error('Invalid Web HTML');
 writeFileSync(ready,'Godot 4.6.3 Web release\n');
 console.log('Web build artifacts verified. Browser/GPU acceptance remains separate.');
}catch(error){console.error(error.message);process.exit(1);}
