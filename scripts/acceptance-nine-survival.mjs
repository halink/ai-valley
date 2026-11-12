#!/usr/bin/env node
// Explicit offline entry only. Preload the existing guard and tsx as documented.
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {resolve,relative,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const validArgs=args.length===1&&args[0]==='--offline'||args.length===3&&args[0]==='--offline'&&args[1]==='--recheck';
if(!validArgs||globalThis.__valleyOfflineGuard!==true){
 console.error('Use the documented clean-environment command with the offline guard and tsx, then --offline [--recheck output/test-tmp/nine-menu-stress-XXXXXX].');
 process.exitCode=2;
}else{
 try{
  const {evaluateSurvivalRecords}=await import('../tests/helpers/nine-resident-survival.ts');
  let directory,legacy=null;
  if(args[1]==='--recheck'){
   directory=resolve(root,args[2]);
   const local=relative(root,directory);
   if(!/^output\/test-tmp\/nine-menu-stress-[A-Za-z0-9]{6}$/.test(local))throw new Error('Only an isolated menu-stress evidence directory is accepted');
   let part=root;
   for(const name of local.split('/')){part=join(part,name);if(lstatSync(part).isSymbolicLink()||!lstatSync(part).isDirectory())throw new Error('Evidence directories must not be symlinks');}
   const artifactInfo=lstatSync(join(directory,'survival-artifact.json'));
   if(!artifactInfo.isFile()||artifactInfo.isSymbolicLink()||artifactInfo.nlink!==1||artifactInfo.size>16*1024)throw new Error('Unsafe or oversized artifact manifest');
   const artifact=JSON.parse(readFileSync(join(directory,'survival-artifact.json'),'utf8'));
   if(artifact.schema!==1||artifact.executionKind!=='offline-scripted-survival-artifact')throw new Error('Unsupported survival artifact');
   for(const filename of ['survival-evidence.jsonl.gz','survival-verdict.json','survival-evaluator-source.ts','controller-source.ts']){
    const path=join(directory,filename),info=lstatSync(path);
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>128*1024*1024)throw new Error('Unsafe or oversized evidence file');
    if(artifact.sha256?.[filename]!==hash(readFileSync(path)))throw new Error('Evidence hash mismatch: '+filename);
   }
   if(artifact.sha256['survival-evaluator-source.ts']!==hash(readFileSync(new URL('../tests/helpers/nine-resident-survival.ts',import.meta.url))))throw new Error('Evaluator source differs; use the original checked-out evaluator');
  }else{
   const {runNineResidentMenuStress}=await import('../tests/helpers/nine-resident-menu-stress.ts');
   const result=runNineResidentMenuStress({days:15,policy:'v4',survivalEvidence:true});directory=result.directory;
   legacy={scriptedSurvivalPassed:result.scriptedSurvivalPassed,actionCoveragePassed:result.actionCoveragePassed,supportCoveragePassed:result.supportCoveragePassed};
   const files=['survival-evidence.jsonl.gz','survival-verdict.json','survival-evaluator-source.ts','controller-source.ts'];
   writeFileSync(join(directory,'survival-artifact.json'),JSON.stringify({schema:1,executionKind:'offline-scripted-survival-artifact',realModelExecuted:false,
    sha256:Object.fromEntries(files.map(name=>[name,hash(readFileSync(join(directory,name)))]))},null,2));
  }
  const text=gunzipSync(readFileSync(join(directory,'survival-evidence.jsonl.gz')),{maxOutputLength:256*1024*1024}).toString('utf8');
  if(!text.endsWith('\n'))throw new Error('Truncated survival journal');
  function* records(){for(const line of text.trimEnd().split('\n'))yield JSON.parse(line);}
  const verdict=evaluateSurvivalRecords(records()),saved=JSON.parse(readFileSync(join(directory,'survival-verdict.json'),'utf8'));
  if(JSON.stringify(verdict)!==JSON.stringify(saved))throw new Error('Repeated evaluation differs from retained verdict');
  console.log(JSON.stringify({directory:relative(root,directory),rechecked:true,legacy,
   syntheticLongTermSurvivalPassed:verdict.syntheticLongTermSurvivalPassed,realModelExecuted:false,modelAutonomyAcceptancePassed:null,
   gates:verdict.gates,failures:verdict.failures,residents:verdict.residents.map(p=>({id:p.id,name:p.name,status:p.final.status,
    minimumHealth:p.minimumHealth,finalHealth:p.final.health,dangerousHungerMinutes:p.dangerousHungerMinutes,
    longestSustainedHungerMinutes:p.longestSustainedHungerMinutes,food:p.food}))},null,2));
  process.exitCode=verdict.syntheticLongTermSurvivalPassed?0:1;
 }catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=2;}
}
