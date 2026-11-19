import {runOfflineChoiceDemo,startOfflineChoiceDemoServer,OFFLINE_CHOICE_DEMO_PATH} from './offline-choice-demo.js';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--json')console.log(JSON.stringify(await runOfflineChoiceDemo()));
else{
 const parsed=new Map<string,string>();
 for(let i=0;i<args.length;i+=2){
  if(!['--port','--web-root'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||parsed.has(args[i]))
   throw Error('usage: --json | [--port PORT] [--web-root EXPORTED_WEB]');
  parsed.set(args[i],args[i+1]);
 }
 const port=parsed.get('--port')??'3418';if(!/^\d{1,5}$/.test(port))throw Error('offline_choice_demo_invalid_port');
 const {server}=await startOfflineChoiceDemoServer({port:Number(port),webRoot:parsed.get('--web-root')});
 const bound=server.address();if(!bound||typeof bound==='string')throw Error('offline_choice_demo_invalid_listener');
 console.log('离线合成演示（非真实模型） http://127.0.0.1:'+bound.port+OFFLINE_CHOICE_DEMO_PATH);
}
