// Retired live PROBE. Keep legacy validation and pure fixture parsing, but no
// credential, process or network capability. A fresh directory is not admission.
import {pathToFileURL} from 'node:url';
import {LEGACY_LIVE_PROBE_DISABLED,rejectLegacyLiveProbe} from './acceptance-legacy-live-policy.mjs';
export function liveProbeLaunch(args){
 if(args.length!==6||args[0]!=='--live-probe'||args[1]!=='--approved-fictional-data'||args[2]!=='--price-observed-at'
  ||args[4]!=='--output'||!args[5].startsWith('/')||args[5].includes('\0'))throw new Error('explicit_live_probe_arguments_required');
 const observed=Number(args[3]),now=Date.now();if(!Number.isSafeInteger(observed)||observed>now||now-observed>12*60_000)throw new Error('fresh_official_price_check_required');
 if(Object.keys(process.env).length)throw new Error('empty_launch_environment_required');
 rejectLegacyLiveProbe();
}
/** Compatibility export only. Never open the configured key, even directly. */
export function readConfiguredSiliconFlowKey(){
 rejectLegacyLiveProbe();
}
export function parseConfiguredSiliconFlowKey(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>8192)throw new Error('siliconflow_key_invalid');
 const matches=text.split(/\r?\n/).filter(line=>/^\s*(?:export\s+)?SILICONFLOW_API_KEY\s*=/.test(line));
 if(matches.length!==1)throw new Error('siliconflow_key_required');
 let key=matches[0].replace(/^\s*(?:export\s+)?SILICONFLOW_API_KEY\s*=\s*/,'').trim();
 if((key.startsWith('"')&&key.endsWith('"'))||(key.startsWith("'")&&key.endsWith("'")))key=key.slice(1,-1);
 if(!/^[A-Za-z0-9._-]{20,512}$/.test(key))throw new Error('siliconflow_key_invalid');return key;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  liveProbeLaunch(process.argv.slice(2));
 }catch(error){
  const allowed=['explicit_live_probe_arguments_required','fresh_official_price_check_required','empty_launch_environment_required',LEGACY_LIVE_PROBE_DISABLED];
  const code=allowed.includes(error?.message)?error.message:'live_probe_not_started';
  console.error(code);process.exitCode=2;
 }
}
