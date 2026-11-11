import {fileURLToPath,pathToFileURL} from 'node:url';

/** Keep this independent of production Vite configuration and all .env files. */
const root=fileURLToPath(new URL('../',import.meta.url));
// Vite's publicDir middleware bypasses fs.deny. Rewrite only these two known
// public assets through ordinary root serving so the file policy still applies.
const publicAssets=new Map(['favicon.svg','THIRD_PARTY_NOTICES.txt'].map(name=>[`/ai-town/${name}`,`/ai-town/public/${name}`]));
export function previewPublicAssets(req,_res,next){
 const original=req.url??'',query=original.indexOf('?');
 const pathname=query<0?original:original.slice(0,query),target=publicAssets.get(pathname);
 if(target)req.url=target+(query<0?'':original.slice(query));
 next();
}
export const previewWebConfig={
 root,configFile:false,envFile:false,publicDir:false,base:'/ai-town/',
 plugins:[{name:'preview-public-assets',configureServer(server){server.middlewares.use(previewPublicAssets);}}],
 server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/ai-town/api':'http://127.0.0.1:3413'},
  fs:{strict:true,allow:[root],deny:['**/.env','**/.env.*','**/*.{crt,pem,key,p12}','**/.git/**','**/secrets/**',
   '**/runtime/**','**/output/**','**/*.{sqlite,sqlite3,db}','**/*.{sqlite,sqlite3,db}-*','**/*.log']}},
};

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {createServer}=await import('vite');
 const server=await createServer(previewWebConfig);
 try{await server.listen();server.printUrls();}catch(error){await server.close();throw error;}
 let closing=false;
 const stop=()=>{if(closing)return;closing=true;void server.close().catch(()=>{process.exitCode=1;});};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
