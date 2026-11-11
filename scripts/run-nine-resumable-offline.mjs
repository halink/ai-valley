// Offline-only resumable candidate. No credential reader or live flag exists.
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {relative,isAbsolute} from 'node:path';
import {assertOfflineSourceTree} from './acceptance-offline-preflight.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
export function resumableOfflineLaunch(args){
 if(args.length!==3||args[0]!=='--offline'||!['--output','--resume'].includes(args[1])||!isAbsolute(args[2])||args[2].includes('\0'))throw new Error('explicit_offline_arguments_required');
 const path=relative(root+'/output',args[2]);
 if(!path||path.startsWith('..')||isAbsolute(path)||args[2].split('/').some(p=>p==='.'||p==='..'))throw new Error('repository_output_required');
 if(Object.keys(process.env).length)throw new Error('empty_launch_environment_required');assertOfflineSourceTree(root);
 return {executable:process.execPath,args:['--import',root+'/scripts/acceptance-offline-guard.mjs','--import',root+'/node_modules/tsx/dist/loader.mjs',root+'/scripts/acceptance-resumable-guardian.mjs',args[2],args[1]==='--output'?'new':'resume'],
  options:{cwd:'/',env:{},shell:false,detached:true,stdio:['pipe','inherit','inherit']}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const launch=resumableOfflineLaunch(process.argv.slice(2)),child=spawn(launch.executable,launch.args,launch.options);
  const stop=()=>child.kill('SIGTERM');process.on('SIGTERM',stop);process.on('SIGINT',stop);child.stdin.on('error',()=>{});
  child.once('error',()=>{console.error('resumable_guardian_launch_failed');process.exitCode=1;});
  child.once('exit',code=>{process.off('SIGTERM',stop);process.off('SIGINT',stop);child.stdin.destroy();process.exitCode=code??1;});
 }catch{console.error('resumable_offline_not_started');process.exitCode=2;}
}
