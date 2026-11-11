/** Lifetime ownership for the formal entrypoint. This is deliberately independent
 * of the world database: even opening WorldStore performs schema writes.
 *
 * The empty sidecar is permanent. SQLite holds an EXCLUSIVE OS file lock without
 * writing a page or journal. Process death releases it, including SIGKILL. There
 * is no PID, lease timeout, stale-file deletion, or signal to another process.
 * Unknown files are never repaired or deleted. This requires a local filesystem
 * with working SQLite file locks; shared/network filesystems are not supported.
 */
import {constants,openSync,closeSync,fstatSync,lstatSync,mkdirSync,statfsSync,type Stats} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export class RuntimeLockError extends Error{
 constructor(readonly code:string){super(code);this.name='RuntimeLockError';}
}
const held=new Set<string>();
// Known local Linux filesystems: ext*, XFS, Btrfs, tmpfs, overlayfs. Fail closed
// on NFS/SMB/FUSE/unknown mounts instead of assuming their locking semantics.
const localFileSystems=new Set([0xef53,0x58465342,0x9123683e,0x01021994,0x794c7630]);
const same=(a:Stats,b:Stats)=>a.dev===b.dev&&a.ino===b.ino;
const identity=(s:Stats)=>`${s.dev}:${s.ino}`;
const child=(fd:number,name:string)=>`/proc/self/fd/${fd}/${name}`;
const absent=(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT';
function optionalStat(path:string){try{return lstatSync(path);}catch(error){if(absent(error))return;throw error;}}
function regular(info:Stats){
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new RuntimeLockError('unsafe_runtime_file');
}
function directoryFd(path:string){
 // No pathname ancestor is followed, including while a directory is created.
 let fd=openSync('/',constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{
  for(const part of path.split('/').filter(Boolean)){
   const nextPath=child(fd,part);
   try{mkdirSync(nextPath,{mode:0o700});}catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='EEXIST'))throw error;}
   const next=openSync(nextPath,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   closeSync(fd);fd=next;
  }
  return fd;
 }catch(error){closeSync(fd);throw error;}
}
function checkSidecars(path:string,lock=false){
 for(const suffix of ['-journal','-wal','-shm']){
  const info=optionalStat(path+suffix);
  if(!info)continue;
  if(lock)throw new RuntimeLockError('unknown_runtime_lock');
  regular(info);
 }
}

export interface RuntimeOwnership{
 /** Descriptor-anchored path; keep this owner alive until WorldStore is closed. */
 readonly database:string;
 readonly lockPath:string;
 assertOwned():void;
 release():void;
}
export function acquireRuntimeOwnership(input:string):RuntimeOwnership{
 if(process.platform!=='linux'||!constants.O_NOFOLLOW||!constants.O_DIRECTORY)
  throw new RuntimeLockError('runtime_lock_requires_linux_local_filesystem');
 if(!input||input.includes('\0')||input===':memory:')throw new RuntimeLockError('invalid_runtime_database');
 const target=resolve(input),name=basename(target);
 if(/(?:\.runtime-lock|-(?:journal|wal|shm))$/i.test(name))throw new RuntimeLockError('invalid_runtime_database');
 let directory=-1,lockFd=-1,db:DatabaseSync|undefined,key:string|undefined,registered=false;
 try{
  directory=directoryFd(dirname(target));
  const parent=fstatSync(directory);
  if(parent.uid!==process.getuid!()||(parent.mode&0o022)!==0)throw new RuntimeLockError('unsafe_runtime_directory');
  if(!localFileSystems.has(statfsSync(child(directory,'.')).type))throw new RuntimeLockError('runtime_lock_requires_linux_local_filesystem');
  const database=child(directory,name),lockPath=database+'.runtime-lock';
  const initial=optionalStat(database);if(initial)regular(initial);
  checkSidecars(database);
  const prior=optionalStat(lockPath);
  if(prior){regular(prior);if(held.has(identity(prior)))throw new RuntimeLockError('runtime_already_owned');}
  // Creating an empty file is atomic. A crash during creation leaves a usable
  // lock, not partially written owner metadata requiring unsafe stale recovery.
  try{lockFd=openSync(lockPath,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error){
   if(!(error&&typeof error==='object'&&'code' in error&&error.code==='EEXIST'))throw error;
   lockFd=openSync(lockPath,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  }
  const info=fstatSync(lockFd);regular(info);
  if(info.size!==0||info.uid!==process.getuid!()||(info.mode&0o022)!==0)throw new RuntimeLockError('unknown_runtime_lock');
  key=identity(info);
  if(held.has(key))throw new RuntimeLockError('runtime_already_owned');
  checkSidecars(lockPath,true);
  // Retain this descriptor until after SQLite closes. Closing another fd for
  // the same inode can release POSIX locks belonging to this process.
  db=new DatabaseSync(`/proc/self/fd/${lockFd}`);
  try{db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=MEMORY; BEGIN EXCLUSIVE;');}
  catch(error){throw new RuntimeLockError('runtime_already_owned_or_lock_unavailable');}
  held.add(key);registered=true;
  let released=false;
  const assertOwned=()=>{
   if(released)throw new RuntimeLockError('runtime_ownership_released');
   const current=optionalStat(lockPath);
   if(!current||!same(info,current)||current.size!==0)throw new RuntimeLockError('runtime_lock_changed');
   regular(current);checkSidecars(lockPath,true);
   const world=optionalStat(database);if(world)regular(world);
   if(initial&&(!world||!same(initial,world)))throw new RuntimeLockError('runtime_database_changed');
   checkSidecars(database);
  };
  assertOwned();
  const handle=db,rawFd=lockFd,dirFd=directory,ownerKey=key;
  return {database,lockPath:target+'.runtime-lock',assertOwned,release(){
   if(released)return;
   // Keep the owner registered and descriptors open if SQLite close fails.
   // A caller must not continue with uncertain ownership release.
   handle.close();released=true;held.delete(ownerKey);
   closeSync(rawFd);closeSync(dirFd);
  }};
 }catch(error){
  // No unlink, rename, repair, or kill: a rejected contender cannot hurt an owner.
  try{db?.close();}finally{
   if(registered&&key)held.delete(key);
   if(lockFd>=0)closeSync(lockFd);
   if(directory>=0)closeSync(directory);
  }
  throw error;
 }
}
