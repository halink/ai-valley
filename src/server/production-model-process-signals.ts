import {readFileSync} from 'node:fs';
import type {ProcessGroupState,ProcessSignalResult} from './acceptance-process-supervisor.js';

type WorkerIdentity={pid:number;startTicks:string};
type Signal='SIGTERM'|'SIGKILL';
type SignalOperations={readStat:(pid:number)=>string;killGroup:(pid:number,signal:Signal)=>void};
const systemOperations:SignalOperations={
 readStat:pid=>readFileSync(`/proc/${pid}/stat`,'utf8'),
 killGroup:(pid,signal)=>{process.kill(-pid,signal);}
};

/** Only the watchdog's own freshly spawned worker identity may be supplied. */
export function signalSyntheticProcessGroup(identity:WorkerIdentity|null,signal:Signal,
 groupState:()=>ProcessGroupState,operations:SignalOperations=systemOperations):ProcessSignalResult{
 if(groupState()==='absent')return 'not_found';
 if(!identity)return 'unknown';
 let raw:string;
 try{raw=operations.readStat(identity.pid);}
 catch(error){
  // The leader can disappear after the first group probe. Missing /proc state
  // alone says nothing about descendants: require a fresh whole-group absence.
  return (error as NodeJS.ErrnoException).code==='ENOENT'&&groupState()==='absent'?'not_found':'unknown';
 }
 const start=raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];
 if(start!==identity.startTicks)return 'unknown';
 try{operations.killGroup(identity.pid,signal);return 'sent';}
 catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH'?'not_found':'unknown';}
}
