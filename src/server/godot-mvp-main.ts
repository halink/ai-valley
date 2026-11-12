import {createMvpSession,createMvpServer,GODOT_MVP_NOTICE,GODOT_MVP_PORT} from './godot-mvp.js';

if(process.argv.length>2)throw new Error('MVP has no configuration or credential arguments');
const session=createMvpSession(),server=createMvpServer(session);
let timer:ReturnType<typeof setInterval>|undefined;
const stop=()=>{if(timer)clearInterval(timer);server.closeAllConnections();server.close();};
server.once('error',error=>{console.error(error.message);stop();process.exitCode=1;});
server.listen(GODOT_MVP_PORT,'127.0.0.1',()=>{
 console.log(GODOT_MVP_NOTICE);
 console.log(`Read-only Godot MVP: http://127.0.0.1:${GODOT_MVP_PORT}/ai-town/api/world`);
 // Two world minutes per second; no model transport, persistence or env file.
 timer=setInterval(()=>session.advance(1),500);
});
process.once('SIGINT',stop);process.once('SIGTERM',stop);
