/** Local browser RULE demo: no .env, keys, persistence or model calls. */
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {createMvpSession,createMvpServer} from './godot-mvp.js';
if(process.argv.length!==2)throw Error('No configuration arguments supported');
const webRoot=fileURLToPath(new URL('../../output/godot-web/',import.meta.url));
if(!existsSync(join(webRoot,'.ready')))throw Error('No verified Web export. Run npm run build:godot:web first.');
const session=createMvpSession();
const server=createMvpServer(session,{webRoot});
let timer:ReturnType<typeof setInterval>|undefined;
const stop=()=>{if(timer)clearInterval(timer);server.closeAllConnections();server.close();};
server.once('error',error=>{console.error(error.message);stop();process.exitCode=1;});
server.listen(3414,'127.0.0.1',()=>{
 console.log('Godot browser RULE demo: http://127.0.0.1:3414 (no models, no saves)');
 timer=setInterval(()=>session.advance(1),500);
});
process.once('SIGINT',stop);process.once('SIGTERM',stop);
