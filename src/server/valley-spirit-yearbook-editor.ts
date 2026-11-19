import {createHash} from 'node:crypto';

interface Weather {sourceRef:string;minute:number;field:'condition'|'temperatureDeciC'|'relativeHumidityPermille';value:string|number;}
interface Life {sourceRef:string;atUs:string;kind:'conversation-completed';grantVersion:number;receiptVersion:number;}
/** Fixture-only. Production needs one independently attested committed head for both readers. */
export interface OfflineYearbookBasis {
 worldId:string;headUs:string;headRevision:number;
 weather:{headUs:string;headRevision:number;entryId:string;textVersion:number;permissionVersion:number;facts:readonly Weather[]};
 life:{headUs:string;headRevision:number;sectionId:string;lines:readonly Life[]};
}
interface Fact {id:string;kind:'weather'|'conversation';text:string;}
interface Draft {version:1;worldId:string;priorEditionId:string|null;sourceDigest:string;selectedIds:string[];lines:Fact[];}
interface Review {version:1;worldId:string;priorEditionId:string|null;renderedDigest:string;approvalReference:string;}
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v:unknown,k:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const pos=(v:number)=>Number.isSafeInteger(v)&&v>0;
const us=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v);
const words={sun:'晴',cloud:'阴',rain:'雨',snow:'雪',mixed:'雨雪混合'} as const;
function normalize(b:OfflineYearbookBasis){
 if(!exact(b,['worldId','headUs','headRevision','weather','life'])||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(b.worldId)||!us(b.headUs)||!Number.isSafeInteger(b.headRevision)||b.headRevision<0||
  !exact(b.weather,['headUs','headRevision','entryId','textVersion','permissionVersion','facts'])||!/^valley-almanac-[a-f0-9]{64}$/.test(b.weather.entryId)||!pos(b.weather.textVersion)||!pos(b.weather.permissionVersion)||
  !exact(b.life,['headUs','headRevision','sectionId','lines'])||!/^valley-life-section-[a-f0-9]{64}$/.test(b.life.sectionId)||
  b.weather.headUs!==b.headUs||b.life.headUs!==b.headUs||b.weather.headRevision!==b.headRevision||b.life.headRevision!==b.headRevision||!Array.isArray(b.weather.facts)||!b.weather.facts.length||b.weather.facts.length>24||!Array.isArray(b.life.lines)||!b.life.lines.length||b.life.lines.length>24)return null;
 const choices=new Map<string,Fact>(),weather=[],life=[];
 for(const f of b.weather.facts){
  if(!exact(f,['sourceRef','minute','field','value'])||!Number.isFinite(f.minute)||f.minute<0||Math.round(f.minute*1_000_000)>Number(b.headUs)||
    f.sourceRef!==b.worldId+'/weather-'+b.weather.permissionVersion+'-'+Math.floor(f.minute/60))return null;
  let value:string;
  if(f.field==='condition'&&typeof f.value==='string'&&Object.hasOwn(words,f.value))value='天气：'+words[f.value as keyof typeof words];
  else if(f.field==='temperatureDeciC'&&Number.isInteger(f.value)&&Number(f.value)>=-300&&Number(f.value)<=450)value='气温：'+(Number(f.value)/10).toFixed(1)+'℃';
  else if(f.field==='relativeHumidityPermille'&&Number.isInteger(f.value)&&Number(f.value)>=0&&Number(f.value)<=1000)value='相对湿度：'+(Number(f.value)/10).toFixed(1)+'%';
  else return null;
  const id=digest(['weather',f.sourceRef,f.field]);if(choices.has(id))return null;
  choices.set(id,{id,kind:'weather',text:'游戏分钟 '+f.minute+'，'+value});weather.push([f.sourceRef,f.minute,f.field,f.value]);
 }
 for(const f of b.life.lines){
  if(!exact(f,['sourceRef','atUs','kind','grantVersion','receiptVersion'])||f.kind!=='conversation-completed'||!pos(f.grantVersion)||f.receiptVersion!==1||
   typeof f.sourceRef!=='string'||!f.sourceRef.startsWith(b.worldId+'/life-')||!hash(f.sourceRef.slice(b.worldId.length+6))||!us(f.atUs)||BigInt(f.atUs)>BigInt(b.headUs))return null;
  const id=digest(['conversation',f.sourceRef]);if(choices.has(id))return null;
  choices.set(id,{id,kind:'conversation',text:'游戏分钟 '+Number(f.atUs)/1_000_000+'，发生了一次实际交谈。'});life.push([f.sourceRef,f.atUs,f.grantVersion,f.receiptVersion]);
 }
 return {worldId:b.worldId,choices,sourceDigest:digest([b.worldId,b.weather.entryId,b.weather.textVersion,b.weather.permissionVersion,weather,b.life.sectionId,life])};
}
/** NOT a publication or durable release. Fixture host supplies independent read
 * and review; there is no raw-source, network, or production adapter. */
export class OfflineYearbookEditionEditor {
 private current:{editionId:string;draft:Draft;withdrawn:boolean}|null=null;
 private readonly usedSources=new Set<string>();
 constructor(private readonly readFixture:()=>OfflineYearbookBasis|null,private readonly verifyFixtureReview:(review:Readonly<Review>)=>boolean){}
 private basis(){const b=this.readFixture();return b&&normalize(b);}
 menu(){try{return [...(this.basis()?.choices.values()??[])].map(({id,kind})=>({id,kind}));}catch{return [];}}
 private make(ids:readonly string[],priorEditionId:string|null):Draft|null{
  const n=this.basis();
  if(!n||!Array.isArray(ids)||ids.length<2||ids.length>12||new Set(ids).size!==ids.length)return null;
  const lines:Fact[]=[];
  for(const id of ids){const f=n.choices.get(id);if(!f)return null;lines.push(f);}
  if(!lines.some(f=>f.kind==='weather')||!lines.some(f=>f.kind==='conversation'))return null;
  return {version:1,worldId:n.worldId,priorEditionId,sourceDigest:n.sourceDigest,selectedIds:[...ids],lines};
 }
 draft(ids:readonly string[]){
  try{
   const draft=this.make(ids,this.current?.editionId??null);
   return draft&&(!this.current||this.current.draft.worldId===draft.worldId&&!this.usedSources.has(draft.sourceDigest))?
    structuredClone({draft,renderedDigest:digest(draft)}):null;
  }catch{return null;}
 }
 approve(ids:readonly string[],review:Review):boolean {
  try{
   const prior=this.current,d=this.draft(ids);
   if(this.usedSources.size>=128||!d||!exact(review,['version','worldId','priorEditionId','renderedDigest','approvalReference'])||review.version!==1||
    review.worldId!==d.draft.worldId||review.priorEditionId!==d.draft.priorEditionId||review.renderedDigest!==d.renderedDigest||
    !hash(review.approvalReference)||this.verifyFixtureReview(Object.freeze({...review}))!==true)return false;
   const checked=this.draft(ids);
   if(this.current!==prior||checked?.renderedDigest!==d.renderedDigest)return false;
   this.usedSources.add(d.draft.sourceDigest);
   this.current={editionId:'offline-edition-'+d.renderedDigest,draft:d.draft,withdrawn:false};return true;
  }catch{return false;}
 }
 read(){
  try{
   const e=this.current;if(!e||e.withdrawn)return null;
   const verified=this.make(e.draft.selectedIds,e.draft.priorEditionId);
   if(!verified||digest(verified)!==digest(e.draft)){e.withdrawn=true;return null;}
   return structuredClone({editionId:e.editionId,draft:e.draft});
  }catch{if(this.current)this.current.withdrawn=true;return null;}
 }
}
