import {resolve} from 'node:path';
import {startPersistentMvp} from './godot-mvp-persistent.js';
if(process.argv.length>2)throw Error('Use explicit process environment; this entrypoint does not load .env files');
const running=await startPersistentMvp({database:resolve(process.env.VALLEY_MVP_DB??'runtime/godot-mvp/world.sqlite'),port:Number(process.env.VALLEY_MVP_PORT??3415),dayMinutes:Number(process.env.VALLEY_DAY_MINUTES??20),env:process.env});
console.log('Persistent small-valley observer started. Models are disabled unless VALLEY_SELF_HOSTED=enabled and explicit provider/model configuration is valid.');
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;running.close().then(()=>process.exit(0),()=>{console.error('MVP shutdown was not clean; inspect the unresolved session before restarting.');process.exit(1);});};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
