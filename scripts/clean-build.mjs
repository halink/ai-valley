// Only rebuildable compiler output. Not a sandbox against hostile concurrent writers.
import {lstatSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {join,parse,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repository=fileURLToPath(new URL('../',import.meta.url));
function info(path){try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function directory(path){const stat=info(path);if(!stat||stat.isSymbolicLink()||!stat.isDirectory())throw Error('unsafe_build_directory');return stat;}
/** Exported for isolated tests; the CLI never accepts a user-supplied root. */
export function cleanBuild(root){
 root=resolve(root);
 let ancestor=parse(root).root;directory(ancestor);
 for(const part of root.slice(ancestor.length).split(/[\\/]/).filter(Boolean)){ancestor=join(ancestor,part);directory(ancestor);}
 const build=join(root,'build');if(!info(build))return;
 const files=[],directories=[];
 const walk=(path,top=false)=>{
  const stat=directory(path);directories.push({path,stat});
  for(const name of readdirSync(path)){
   const child=join(path,name),entry=lstatSync(child);
   if(entry.isSymbolicLink())throw Error('unsafe_build_symlink');
   if(entry.isDirectory()){
    if(top&&!['server','shared','world'].includes(name))throw Error('unexpected_build_directory');
    walk(child);
   }else{
    if(top||!entry.isFile()||entry.nlink!==1||!/^.+\.js(?:\.map)?$/.test(name))throw Error('unexpected_build_file');
    files.push({path:child,stat:entry});
   }
  }
 };
 walk(build,true); // Complete preflight before deleting anything.
 const unchanged=({path,stat})=>{const now=lstatSync(path);if(now.isSymbolicLink()||now.dev!==stat.dev||now.ino!==stat.ino||now.mode!==stat.mode||now.nlink!==stat.nlink)throw Error('build_changed_during_cleanup');};
 for(const entry of files){unchanged(entry);unlinkSync(entry.path);}
 // Directory link counts change while children are removed; compare identity/type only.
 for(const {path,stat} of directories.reverse()){
  const now=lstatSync(path);if(!now.isDirectory()||now.isSymbolicLink()||now.dev!==stat.dev||now.ino!==stat.ino)throw Error('build_changed_during_cleanup');
  rmdirSync(path);
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2)throw Error('clean_build_accepts_no_arguments');
 cleanBuild(repository);
}
