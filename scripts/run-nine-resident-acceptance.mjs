// Public entry is deliberately OFFLINE ONLY. No --run/--resume/model/key options.
// Use plain node, not npm or an inherited --import preloader.
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertOfflineSourceTree} from './acceptance-offline-preflight.mjs';
const guard=fileURLToPath(new URL('./acceptance-offline-guard.mjs',import.meta.url));
const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
const guardian=fileURLToPath(new URL('./acceptance-offline-guardian.mjs',import.meta.url));
export function offlineLaunch(args){
 if(args.length!==3||args[0]!=='--offline'||args[1]!=='--output'||!args[2].startsWith('/')||args[2].includes('\0'))
  throw new Error('Usage: node scripts/run-nine-resident-acceptance.mjs --offline --output /absolute/new-directory');
 assertOfflineSourceTree(fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''));
 return {executable:process.execPath,args:['--import',guard,'--import',loader,guardian,args[2],'endpoint'],
  options:{cwd:'/',env:{},shell:false,detached:true,stdio:['pipe','inherit','inherit']}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const launch=offlineLaunch(process.argv.slice(2)),child=spawn(launch.executable,launch.args,launch.options);
  const onInt=()=>child.kill('SIGINT'),onTerm=()=>child.kill('SIGTERM');
  process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
  // Keeping this pipe open proves owner liveness. SIGKILL closes it in the OS;
  // the detached guardian independently stops and reaps its runtime group.
  child.stdin.on('error',()=>{});
  child.once('error',()=>{console.error('offline_guardian_launch_failed');process.exitCode=1;});
  child.once('exit',code=>{process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);child.stdin.destroy();process.exitCode=code??1;});
 }catch(error){console.error(error.message);process.exitCode=2;}
}
