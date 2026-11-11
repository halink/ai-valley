import {resolve} from 'node:path';
import {startFormalServer} from './formal-startup.js';
import {FORMAL_DAY_MINUTES} from '../world/time.js';
import {readProductionModelPolicy} from './production-model-policy.js';

const port=Number(process.env.PORT??3412);
const mode='formal';
if(process.env.VALLEY_MODE&&process.env.VALLEY_MODE!==mode)throw new Error('The server only runs the formal world');
const dayMinutes=Number(process.env.VALLEY_DAY_MINUTES??FORMAL_DAY_MINUTES);
// Production model activation is a separate safety gate. No key file or .env is
// read by startup, and credentials alone do not authorize model dispatch.
const policy=readProductionModelPolicy(process.env);
const running=await startFormalServer({port,database:resolve(process.env.VALLEY_DB??`runtime/${mode}.sqlite`),
 root:resolve('dist'),dayMinutes,providers:[],productionModelPolicy:policy});
const address=running.server.address();
console.log(`Valley observer listening on 127.0.0.1:${address&&typeof address!=='string'?address.port:port}; ${mode} world; model ${policy.state}: ${policy.reason}`);
let stopping=false;
const stop=()=>{
 if(stopping)return;stopping=true;
 running.close().then(()=>process.exit(0),error=>{console.error('Formal server shutdown failed.',error);process.exit(1);});
};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
