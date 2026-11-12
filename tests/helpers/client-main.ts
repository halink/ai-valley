import {readFileSync} from 'node:fs';
import ts from 'typescript';
import type {Snapshot} from '../../src/shared/types.js';
import * as history from '../../src/client/history.js';

// Execute the real entrypoint with DOM/Phaser/transport spies. This checks event
// ordering and HTML state without a browser, GPU, real server or saved world.
const sourceURL=new URL('../../src/client/main.ts',import.meta.url);
const source=readFileSync(sourceURL,'utf8');
const parsed=ts.createSourceFile('main.ts',source,ts.ScriptTarget.ES2022,true);
const dependencies:Record<string,unknown>={};
for(const node of parsed.statements){
 if(!ts.isImportDeclaration(node)||node.importClause?.isTypeOnly||!ts.isStringLiteral(node.moduleSpecifier))continue;
 const name=node.moduleSpecifier.text;
 if(name.endsWith('.css')||['phaser','./scene.js','./atlas.js','./history.js','./isometric-observer.js'].includes(name))continue;
 dependencies[name]=await import(new URL(name,sourceURL).href);
}
const code=ts.transpileModule(source.replace("import('./panel-renderers.js')",'loadPanels()'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText;

class ElementSpy {
 private html='';private scroll=0;private limit=Infinity;
 textContent='';className='';dataset:Record<string,string>={};scrollLimitForHTML?:(html:string)=>number;
 get innerHTML(){return this.html;}set innerHTML(value:string){this.html=value;if(this.scrollLimitForHTML)this.limit=this.scrollLimitForHTML(value);this.scrollTop=this.scroll;}
 get scrollTop(){return this.scroll;}set scrollTop(value:number){this.scroll=Math.max(0,Math.min(value,this.limit));}
 set scrollLimit(value:number){this.limit=value;this.scrollTop=this.scroll;}
 private listeners=new Map<string,(event:any)=>void>();
 private classes=new Set<string>();
 classList={add:(name:string)=>this.classes.add(name),remove:(name:string)=>this.classes.delete(name),
  contains:(name:string)=>this.classes.has(name),toggle:(name:string,force?:boolean)=>{const on=force??!this.classes.has(name);if(on)this.classes.add(name);else this.classes.delete(name);return on;}};
 append(){}addEventListener(type:string,fn:(event:any)=>void){this.listeners.set(type,fn);}emit(type:string,event:unknown={}){this.listeners.get(type)?.(event);}focus(){}contains(){return false;}replaceChildren(){this.innerHTML='';}
 querySelectorAll(){return [];}querySelector(){return null;}
}
export async function clientMainHarness(snapshot:Snapshot,loadPanels:()=>Promise<unknown>,archiveFetch:typeof fetch=async()=>new Response('',{status:503}),mountObserver?:(adapter:unknown)=>void){
 const elements=new Map<string,ElementSpy>();
 const el=(id:string)=>{if(!elements.has(id))elements.set(id,new ElementSpy());return elements.get(id)!;};
 el('panel').classList.add('hidden');
 const events=new Map<string,(event:any)=>void>();
 const document={activeElement:null,head:new ElementSpy(),createElement:()=>new ElementSpy(),getElementById:el,
  querySelector:(selector:string)=>selector==='#app'?el('app'):null,querySelectorAll:()=>[],
  addEventListener:(type:string,fn:(event:any)=>void)=>events.set(type,fn)};
 const accepted:Snapshot[]=[];let homeCalls=0,worldRequests=0,eventSources=0,observerMountCalls=0;const warnings:unknown[][]=[];
 class Scene {
  followState=null;accept(next:Snapshot){accepted.push(next);}home(){homeCalls++;}stopFollowing(){}
  focusPerson(){}clearSelection(){}exitRoom(){}zoom(){}watchTile(){}cameraTile(){return {x:0,y:0};}
 }
 const updates=new Map<string,(event:any)=>void>();
 class Source {constructor(){eventSources++;}addEventListener(type:string,fn:(event:any)=>void){updates.set(type,fn);}close(){}}
 const replacements={...dependencies,'./storybook-ui-shell.css':{},'./storybook-ui-shell.js':{mountStorybookUIShell:()=>({active:true})},'./styles.css':{},'./isometric-observer.css':{},'./isometric-observer.js':{mountIsometricObserver:(adapter:unknown)=>{observerMountCalls++;mountObserver?.(adapter);}},phaser:{Game:class{},AUTO:0,Scale:{RESIZE:0}},
  './scene.js':{ValleyScene:Scene},'./atlas.js':{Atlas:class{canvas=new ElementSpy();},currentRegion:()=>null},
  './history.js':{...history,HistoryReader:class extends history.HistoryReader {
   constructor(base:string,changed:()=>void){super(base,changed,archiveFetch);}
  },BiographyReader:class extends history.BiographyReader {
   constructor(base:string,changed:()=>void){super(base,changed,archiveFetch);}
  }},
 } as Record<string,unknown>;
 const module={exports:{}};
 new Function('require','module','exports','document','window','fetch','EventSource','HTMLElement','loadPanels','FormData','console',code)(
  (name:string)=>{if(!(name in replacements))throw new Error('Unstubbed client dependency '+name);return replacements[name];},
  module,module.exports,document,{location:{origin:'http://client.test'},innerWidth:1280,innerHeight:800,setTimeout:()=>{}},
  async()=>{worldRequests++;return {ok:true,json:async()=>snapshot};},Source,ElementSpy,loadPanels,class {constructor(private form:{values:Record<string,string>}){}get(key:string){return this.form.values[key]??null;}has(key:string){return key in this.form.values;}},{warn:(...args:unknown[])=>warnings.push(args)},
 );
 await new Promise<void>(resolve=>setImmediate(resolve));
 return {el,accepted,warnings,get observerMountCalls(){return observerMountCalls;},get worldRequests(){return worldRequests;},get eventSources(){return eventSources;},get homeCalls(){return homeCalls;},
  click:(dataset:Record<string,string>)=>events.get('click')!({target:{closest:()=>({dataset})}}),
  scroll:(value:number)=>{el('panel-body').scrollTop=value;el('panel-body').emit('scroll');},
  interact:(type:string)=>el('panel-body').emit(type),
  filter:(id:string,values:Record<string,string>)=>events.get('submit')!({target:{closest:()=>({dataset:{historyFilters:id},values})},preventDefault(){}}),
  escape:()=>events.get('keydown')!({key:'Escape',target:{matches:()=>false}}),
  update:(next:Snapshot)=>updates.get('update')!({data:JSON.stringify({worldId:next.world.id,mapRevision:next.mapRevision,
   world:next.world,version:next.version,serverTime:next.serverTime,capabilities:next.capabilities})}),
 };
}
