// Offline preparation only. This program has no run mode, keys, database or model adapter.
// Usage: node --import tsx scripts/prepare-nine-resident-acceptance.mjs --prepare
import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';

if(process.argv.slice(2).join(' ')!=='--prepare'){
 console.error('Offline preparation only. Usage: node --import tsx scripts/prepare-nine-resident-acceptance.mjs --prepare');
 process.exitCode=2;
}else{
 // Only allowlisted repository source/configuration; never .env, runtime, secrets, or saves.
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const files=[];
 function collect(path){
  if(relative(root,path).split(/[\\/]/).some(part=>part==='runtime'||part==='secrets'||part.startsWith('.env')))throw new Error('Restricted path inside the source tree.');
  const info=lstatSync(path);if(info.isSymbolicLink())throw new Error('Source symlinks are not allowed in the preparation fingerprint.');
  if(info.isDirectory())for(const entry of readdirSync(path).sort())collect(resolve(path,entry));
  else if(info.isFile()&&/\.(ts|css|json|mjs)$/.test(path))files.push(path);
 }
 for(const name of ['src','scripts/prepare-nine-resident-acceptance.mjs','package.json','package-lock.json','tsconfig.json','tsconfig.server.json'])collect(resolve(root,name));
 const entries=files.sort().map(path=>({path:relative(root,path),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
 const sourceFingerprint=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
 const {prepareNineResidentAcceptance}=await import('../src/server/nine-resident-acceptance.ts');
 console.log(JSON.stringify({...prepareNineResidentAcceptance(sourceFingerprint),
  environment:{node:process.version,platform:process.platform,arch:process.arch},sourceFiles:entries},null,2));
}
