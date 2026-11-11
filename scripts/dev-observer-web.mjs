import {fileURLToPath,pathToFileURL} from 'node:url';
export function observerReadOnlyAPI(req,res,next){
 const path=(req.url??'').split('?')[0];if(!path.startsWith('/ai-town/api'))return next();
 if(req.method==='GET'&&['/ai-town/api/world','/ai-town/api/events'].includes(path))return next();
 res.statusCode=req.method==='GET'?404:405;res.setHeader('Allow','GET');res.end('Read-only observer endpoint');
}
const root=fileURLToPath(new URL('../',import.meta.url));
export const observerWebConfig={root,configFile:false,envFile:false,publicDir:false,base:'/ai-town/',
 plugins:[{name:'optional-observer-preview',apply:'serve',configureServer(server){server.middlewares.use(observerReadOnlyAPI);},transformIndexHtml(){return [{tag:'script',attrs:{type:'module',src:'/ai-town/src/client/development-preview.ts'},injectTo:'body'}];}}],
 server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/ai-town/api':'http://127.0.0.1:3413'},fs:{strict:true,allow:[root],deny:['**/.env','**/.env.*','**/*.{crt,pem,key,p12}','**/.git/**','**/secrets/**','**/runtime/**','**/output/**','**/*.{sqlite,sqlite3,db}','**/*.{sqlite,sqlite3,db}-*','**/*.log']}}};
export function observerWebConfigForSource(source='synthetic'){
 if(!['synthetic','live'].includes(source))throw new Error('observer_source');
 return {...observerWebConfig,server:{...observerWebConfig.server,proxy:{'/ai-town/api':source==='live'?'http://127.0.0.1:3412':'http://127.0.0.1:3413'}}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.slice(2).some(v=>v!=='--live')||process.argv.length>3)throw new Error('Only --live is supported; no external URL or credential options');
 const {createServer}=await import('vite'),server=await createServer(observerWebConfigForSource(process.argv.includes('--live')?'live':'synthetic'));
 try{await server.listen();server.printUrls();}catch(error){await server.close();throw error;}
 let closing=false;const stop=()=>{if(closing)return;closing=true;void server.close().catch(()=>{process.exitCode=1;});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
