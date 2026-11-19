import {createServer} from 'node:http';
import type {DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';
import type {DisconnectedWeatherUseContext} from './valley-spirit-weather-use-grant.js';
import {openPrivateWeatherEditorial} from './valley-spirit-private-weather-editorial.js';

const PATH='/developer/weather-review';
const mode='isolated-private-weather-review' as const;
const heads={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
export type PrivateWeatherReviewDto=NonNullable<ReturnType<ReturnType<typeof openPrivateWeatherEditorial>['readForDeveloperDisplay']>>;

/** Explicit isolated developer listener. It borrows the real fixture owner,
 * has no ordinary server hooks, and never exposes the editor itself. */
export async function startPrivateWeatherReviewLoopback(options:{
 mode:typeof mode;owner:DeveloperMvpSpiritFixtureOwner;context:DisconnectedWeatherUseContext;pinnedEntryId:string;
}){
 if(options.mode!==mode||typeof options.pinnedEntryId!=='string'||!/^valley-almanac-[a-f0-9]{64}$/.test(options.pinnedEntryId))
  throw Error('private_weather_review_loopback_disabled');
 const {pinnedEntryId}=options;
 const editor=openPrivateWeatherEditorial(options.owner,options.context);
 const server=createServer((req,res)=>{
  const unavailable=()=>{res.writeHead(404,heads);res.end('{"status":"unavailable"}');};
  try{
   const address=server.address();
   if(!address||typeof address==='string'||req.method!=='GET'||req.url!==PATH||req.socket.remoteAddress!=='127.0.0.1')
    return unavailable();
   const expected='127.0.0.1:'+address.port,fetchSite=req.headers['sec-fetch-site'];
   if(req.headers.host!==expected||req.headersDistinct.host?.length!==1||
      req.headers.authorization!==undefined||req.headers.cookie!==undefined||req.headers['proxy-authorization']!==undefined||
      req.headers.origin!==undefined&&req.headers.origin!=='http://'+expected||fetchSite==='cross-site')return unavailable();
   const dto=editor.readForDeveloperDisplay(pinnedEntryId);
   if(!dto)return unavailable();
   const body=JSON.stringify(dto);
   res.writeHead(200,heads);res.end(body);
  }catch{return unavailable();}
 });
 try{
  await new Promise<void>((resolve,reject)=>{
   const fail=(error:Error)=>reject(error);server.once('error',fail);
   server.listen(0,'127.0.0.1',()=>{server.off('error',fail);resolve();});
  });
  const bound=server.address();
  if(!bound||typeof bound==='string')throw Error('private_weather_review_loopback_address');
  let closing:Promise<void>|undefined;
  return Object.freeze({url:`http://127.0.0.1:${bound.port}${PATH}`,close:()=>closing??=new Promise<void>((resolve,reject)=>{
   server.close(error=>{try{editor.close();}catch(e){reject(e);return;}error?reject(error):resolve();});server.closeAllConnections();
  })});
 }catch(error){server.close();editor.close();throw error;}
}
