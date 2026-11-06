import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {WorldStore} from './store.js';
import {ValleyRuntime} from './runtime.js';
import {createObserverServer} from './http.js';
import {QWEN_MODEL,DEEPSEEK_MODEL,type ModelConnection} from './model-completion.js';
import {FORMAL_DAY_MINUTES} from '../world/time.js';
const port=Number(process.env.PORT??3412);
const mode='formal';
if(process.env.VALLEY_MODE&&process.env.VALLEY_MODE!==mode)throw new Error('The server only runs the formal world');
let siliconflow=process.env.SILICONFLOW_API_KEY?.trim()??'';
if(!siliconflow&&process.env.VALLEY_KEY_FILE){
 try{const credentials=JSON.parse(readFileSync(process.env.VALLEY_KEY_FILE,'utf8'));if(typeof credentials.siliconflow==='string')siliconflow=credentials.siliconflow.trim();}
 catch{console.error('Could not read the SiliconFlow credential file.');}
}
let dashscope=process.env.DASHSCOPE_API_KEY?.trim()??'';
if(!dashscope&&process.env.VALLEY_DASHSCOPE_KEY_FILE){
 try{dashscope=readFileSync(process.env.VALLEY_DASHSCOPE_KEY_FILE,'utf8').trim();}
 catch{console.error('Could not read the DashScope credential file.');}
}
const providers:ModelConnection[]=[];
if(dashscope)providers.push({model:QWEN_MODEL,key:dashscope});
if(siliconflow)providers.push({model:DEEPSEEK_MODEL,key:siliconflow});
const dayMinutes=Number(process.env.VALLEY_DAY_MINUTES??FORMAL_DAY_MINUTES);
if(!Number.isFinite(dayMinutes)||dayMinutes<20||dayMinutes>1440)throw new Error('Invalid world clock setting');
const store=new WorldStore(resolve(process.env.VALLEY_DB??`runtime/${mode}.sqlite`));
const runtime=new ValleyRuntime(store,providers,undefined,{dayMinutes,mode});
const server=createObserverServer(runtime,store,resolve('dist'));
server.listen(port,'127.0.0.1',()=>{console.log(`Valley observer listening on 127.0.0.1:${port}; ${mode} world; model ${runtime.world.metrics.configured?runtime.world.metrics.model:'not configured'}`);runtime.start();});
const stop=()=>{runtime.stop();server.closeAllConnections();server.close(()=>{store.close();process.exit(0);});};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
