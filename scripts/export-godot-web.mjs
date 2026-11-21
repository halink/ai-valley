import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync,unlinkSync,mkdtempSync,renameSync,rmSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createGodotWebManifest,godotWebSourceDigest,WEB_TYPES} from '../src/server/godot-web-provenance.ts';
const cwd=fileURLToPath(new URL('../',import.meta.url)),out=join(cwd,'output/godot-web'),ready=join(out,'.ready');
mkdirSync(out,{recursive:true});
if(existsSync(ready))unlinkSync(ready); // Never present stale exports after a failed rebuild.
const stage=mkdtempSync(join(out,'.valley-web-stage-'));
const env={PATH:process.env.PATH??'',LANG:'C.UTF-8',GODOT_SILENCE_ROOT_WARNING:'1'};
for(const key of ['HOME','XDG_DATA_HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','SystemRoot','WINDIR'])if(process.env[key])env[key]=process.env[key];
function run(args){
 const result=spawnSync('godot',args,{cwd,env,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
 const output=(result.stdout??'')+(result.stderr??'');process.stdout.write(output);
 if(result.error||result.status!==0||/(?:SCRIPT ERROR:|ERROR:|Assertion failed)/i.test(output))throw Error('Godot import/export failed; no usable Web build recorded');
 return output;
}
try{
 const engine=run(['--version']).split(/\r?\n/).filter(line=>/^4\.6\.3\.stable(?:\.[a-zA-Z0-9.-]+)?$/.test(line));
 if(engine.length!==1)throw Error('Godot 4.6.3 stable required');
 run(['--headless','--editor','--path','godot-client','--import']);
 const project=realpathSync(join(cwd,'godot-client')),source=godotWebSourceDigest(project);
 run(['--headless','--path','godot-client','--export-release','Web',join(stage,'index.html')]);
 if(godotWebSourceDigest(project)!==source)throw Error('Godot project changed during export');
 const manifest=createGodotWebManifest(stage,source,engine[0]),names=JSON.parse(manifest).artifacts;
 for(const file of Object.keys(WEB_TYPES)){
  if(Object.hasOwn(names,file))renameSync(join(stage,file),join(out,file));
  else rmSync(join(out,file),{force:true});
 }
 writeFileSync(join(stage,'.ready'),manifest,{flag:'wx'});
 renameSync(join(stage,'.ready'),ready);
 console.log('Web build artifacts verified. Browser/GPU acceptance remains separate.');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{rmSync(stage,{recursive:true,force:true});}
