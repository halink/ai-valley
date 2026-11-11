// Fixed project-owned locations, independent of the caller's cwd and temp env.
// This prevents accidental symlink escapes; it is not a hostile-user OS sandbox.
import {lstatSync,mkdirSync} from 'node:fs';
import {join,parse,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=resolve(fileURLToPath(new URL('../',import.meta.url)));
function directory(path){
 const info=lstatSync(path);
 if(info.isSymbolicLink()||!info.isDirectory())throw new Error('unsafe_repository_temporary_directory');
}
function localDirectory(parts){
 // Check each existing ancestor before creating anything below the repository.
 const volume=parse(repository).root;
 let path=volume;directory(path);
 for(const part of repository.slice(volume.length).split(/[\\/]/).filter(Boolean)){
  path=join(path,part);directory(path);
 }
 for(const part of parts){
  path=join(path,part);
  try{mkdirSync(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  directory(path);
 }
 return path;
}
// Evidence/offline guards intentionally reject "runtime" in any path component.
export function testTmpdir(){return localDirectory(['output','test-tmp']);}
export function previewTmpdir(){return localDirectory(['runtime','dev-preview']);}
