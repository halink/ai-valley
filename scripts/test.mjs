// Keep test-runner tooling in a unique local directory too. Individual fixtures
// own separate mkdtemp directories and remove only their own files.
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {testTmpdir} from './repository-temporary.mjs';

const repository=fileURLToPath(new URL('../',import.meta.url));
const temporary=mkdtempSync(join(testTmpdir(),'test-tools-'));
const cleanup=()=>rmSync(temporary,{recursive:true,force:true});
try{
 const home=join(temporary,'home');mkdirSync(home,{mode:0o700});
 const tests=readdirSync(new URL('../tests/',import.meta.url)).filter(name=>name.endsWith('.test.ts')).sort()
 .map(name=>fileURLToPath(new URL(`../tests/${name}`,import.meta.url)));
 const child=spawn(process.execPath,['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),
  '--test',...process.argv.slice(2),...tests],{cwd:repository,
  env:{...process.env,HOME:home,USERPROFILE:home,TMPDIR:temporary,TMP:temporary,TEMP:temporary},stdio:'inherit',shell:false});
 const interrupt=()=>child.kill('SIGINT'),terminate=()=>child.kill('SIGTERM');
 process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
 const finish=()=>{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);cleanup();};
 child.once('error',error=>{finish();console.error(`Tests could not start: ${error.message}`);process.exitCode=1;});
 child.once('exit',(code,signal)=>{finish();process.exitCode=code??(signal==='SIGINT'?130:signal==='SIGTERM'?143:1);});
}catch(error){cleanup();throw error;}
