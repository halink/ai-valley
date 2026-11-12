import {resolve} from 'node:path';
import {startSelfHostedServer} from './self-hosted-startup.js';
const running=await startSelfHostedServer({port:Number(process.env.PORT??3412),database:resolve(process.env.VALLEY_DB??'runtime/self-hosted.sqlite'),root:resolve('dist'),dayMinutes:Number(process.env.VALLEY_DAY_MINUTES??20),env:process.env});
console.log('Self-hosted observer started. Provider pricing and actual charges are unverified; this is not the supervised acceptance runner.');
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;running.close().then(()=>process.exit(0),()=>{console.error('Self-hosted shutdown failed; inspect session state before restarting.');process.exit(1);});};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
