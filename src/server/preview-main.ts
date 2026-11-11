import {resolve} from 'node:path';
import {createObserverServer} from './http.js';
import {createPreviewSession,PREVIEW_PORT} from './preview.js';

if(process.argv.length>2)throw new Error('Development preview does not accept configuration overrides');
const preview=createPreviewSession();
let server:ReturnType<typeof createObserverServer>;
try{server=createObserverServer(preview.runtime,preview.store,resolve('dist'));}
catch(error){preview.close();throw error;}
let closing=false;
const stop=()=>{
 if(closing)return;closing=true;
 server.closeAllConnections();server.close(()=>preview.close());
};
server.once('error',error=>{
 console.error(`Preview could not listen on 127.0.0.1:${PREVIEW_PORT}: ${error.message}`);
 preview.close();process.exitCode=1;
});
server.listen(PREVIEW_PORT,'127.0.0.1',()=>{
 console.log(`Isolated static preview: http://127.0.0.1:${PREVIEW_PORT}/ai-town/`);
 console.log(`New disposable database: ${preview.database}; external models and environment files are disabled.`);
 // Intentionally do not start the simulation clock or model scheduler.
});
process.once('SIGINT',stop);process.once('SIGTERM',stop);
