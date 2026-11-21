import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import type {renderOneSeasonalWeatherReview} from './valley-spirit-almanac.js';

export const SEASONAL_LOCAL_WEATHER_DESKTOP_MODE='explicit-loopback-native-seasonal-weather-review';
const PATH='/desktop/local-seasonal-weather';
const TOKEN='x-valley-local-preview';
type Edition=Readonly<{status:'local-reviewed-offline-weather-edition';origin:'offline-synthetic';textVersion:1;
 rendered:NonNullable<ReturnType<typeof renderOneSeasonalWeatherReview>>}>;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
 'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",Connection:'close'};
const int=(x:unknown,min:number,max:number)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min&&x<=max;
function project(e:Edition|null){
 if(e?.status!=='local-reviewed-offline-weather-edition'||e.origin!=='offline-synthetic'||e.textVersion!==1||
    e.rendered.rendererVersion!==1||e.rendered.facts.length!==1)return null;
 const {minute,field,value}=e.rendered.facts[0];
 if(!int(minute,0,100_000_000)||
    !(field==='condition'&&typeof value==='string'&&['sun','cloud','rain','snow','mixed'].includes(value)||
      field==='temperatureDeciC'&&int(value,-300,450)||field==='relativeHumidityPermille'&&int(value,0,1000)))return null;
 return {schemaVersion:1 as const,mode:'local-seasonal-offline-weather-preview' as const,origin:e.origin,
  rendererVersion:1 as const,fact:{minute,field,value}};
}
/** The owning Seasonal closure lends its revalidating, read-only reader. This
 * opens only a separate native loopback listener, never the ordinary facade. */
export async function startSeasonalLocalWeatherDesktop(readLatest:()=>Edition|null){
 const capability=randomBytes(32).toString('base64url'),key=Buffer.from(capability);
 let closing:Promise<void>|undefined,closed=false;
 const server=createServer({maxHeaderSize:4096,headersTimeout:2500,requestTimeout:2500,connectionsCheckingInterval:1000},(req,res)=>{
  const unavailable=()=>{res.writeHead(404,headers);res.end('{"status":"unavailable"}');};
  try{
   const address=server.address();
   if(closed||!address||typeof address==='string'||req.method!=='GET'||req.url!==PATH||req.socket.remoteAddress!=='127.0.0.1')return unavailable();
   const h=req.headers,host='127.0.0.1:'+address.port,t=h[TOKEN];
   if(h.host!==host||req.headersDistinct.host?.length!==1||req.headersDistinct[TOKEN]?.length!==1||
      h.origin!==undefined||h.referer!==undefined||h.authorization!==undefined||h['proxy-authorization']!==undefined||h.cookie!==undefined||
      h.forwarded!==undefined||Object.keys(h).some(k=>k.startsWith('sec-fetch-')||k.startsWith('x-forwarded-'))||
      h['transfer-encoding']!==undefined||h['content-length']!==undefined&&h['content-length']!=='0'||
      typeof t!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(t)||!timingSafeEqual(key,Buffer.from(t)))return unavailable();
   const dto=project(readLatest());
   if(!dto)return unavailable();
   res.writeHead(200,headers);res.end(JSON.stringify(dto));
  }catch{return unavailable();}
 });
 server.maxRequestsPerSocket=1;
 server.maxConnections=16;server.setTimeout(2500);
 try{
  await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',()=>{server.off('error',fail);ok();});});
  const bound=server.address();
  if(!bound||typeof bound==='string')throw Error('seasonal_local_weather_desktop_bind');
  return Object.freeze({
   descriptor:Object.freeze({url:'http://127.0.0.1:'+bound.port+PATH,headers:Object.freeze({[TOKEN]:capability}),
    godotArgs:Object.freeze(['--weather-seasonal-preview-port='+bound.port]),
    godotEnvironment:Object.freeze({VALLEY_SEASONAL_WEATHER_PREVIEW_TOKEN:capability})}),
   close:()=>closing??=(closed=true,new Promise<void>(ok=>{server.close(()=>ok());server.closeAllConnections();})),
  });
 }catch(e){server.close();server.closeAllConnections();throw e;}
}
