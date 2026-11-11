import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

/** Only OS bootstrap variables survive. Never inherit credentials, Node preloads,
 * npm configuration, VITE_* values, proxy settings or a caller-selected database. */
export function previewEnvironment(source){
 const env={};
 for(const key of Object.keys(source)){
  if(!/^(SystemRoot|WINDIR)$/i.test(key))continue;
  const value=source[key];if(typeof value==='string')env[key]=value;
 }
 return env;
}

export function previewLaunch(args,source){
 if(args.length>1||(args.length===1&&args[0]!=='--web'))throw new Error('Usage: node scripts/dev-preview.mjs [--web]. Database, model, port and environment-file overrides are not supported.');
 const web=args[0]==='--web';
 return {executable:process.execPath,args:web
  ? [fileURLToPath(new URL('./dev-preview-web.mjs',import.meta.url))]
  : ['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),fileURLToPath(new URL('../src/server/preview-main.ts',import.meta.url))],
  options:{cwd:root,env:previewEnvironment(source),stdio:'inherit',shell:false}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const launch=previewLaunch(process.argv.slice(2),process.env);
  const child=spawn(launch.executable,launch.args,launch.options);
  const onSignal=signal=>{if(child.exitCode===null&&child.signalCode===null)child.kill(signal);};
  const onInterrupt=()=>onSignal('SIGINT'),onTerminate=()=>onSignal('SIGTERM');
  process.on('SIGINT',onInterrupt);process.on('SIGTERM',onTerminate);
  const cleanup=()=>{process.off('SIGINT',onInterrupt);process.off('SIGTERM',onTerminate);};
  child.once('error',error=>{cleanup();console.error(`Preview could not start: ${error.message}`);process.exitCode=1;});
  child.once('exit',(code,signal)=>{cleanup();process.exitCode=code??(signal==='SIGINT'?130:signal==='SIGTERM'?143:1);});
 }catch(error){console.error(error.message);process.exitCode=1;}
}
