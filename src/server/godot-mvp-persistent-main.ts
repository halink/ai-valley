import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {startPersistentMvp,startProtectedMvpObserver} from './godot-mvp-persistent.js';
if(process.argv.length>2)throw Error('Use explicit process environment; this entrypoint does not load .env files');
const options={webRoot:fileURLToPath(new URL('../../output/godot-web/',import.meta.url)),database:resolve(process.env.VALLEY_MVP_DB??'runtime/godot-mvp/world.sqlite'),port:Number(process.env.VALLEY_MVP_PORT??3415),dayMinutes:Number(process.env.VALLEY_DAY_MINUTES??20),env:process.env};
const running=await startPersistentMvp(options).catch(error=>{
 if(error instanceof Error&&['godot_mvp_unresolved_session','godot_mvp_unresolved_requests'].includes(error.message))return startProtectedMvpObserver(options);
 throw error;
});
console.log('runtime' in running?'Persistent Godot browser service started on loopback.':'Protected Godot save is available for read-only observation. Model requests remain paused.');
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;running.close().then(()=>process.exit(0),()=>{console.error('MVP shutdown was not clean; inspect the unresolved session before restarting.');process.exit(1);});};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
