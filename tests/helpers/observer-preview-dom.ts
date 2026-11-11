/** Minimal event/canvas adapter, not browser/CSS/GPU validation. */
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {runInNewContext} from 'node:vm';
import * as preview from '../../src/client/isometric-preview.js';
import {ResidentFollow,residentFollowText,type ResidentFollowState,type ResidentFollowResolver} from '../../src/client/resident-follow.js';
import type {Snapshot,Vec} from '../../src/shared/types.js';
import type {ValleyScene} from '../../src/client/scene.js';
export class ObserverElement {
 dataset:Record<string,string>={};attrs=new Map<string,string>();hidden=false;disabled=false;removed=false;textContent='';innerHTML='';className='';width=0;height=0;tabIndex=0;
 rect={left:0,top:0,width:390,height:844};children:ObserverElement[]=[];queries=new Map<string,ObserverElement>();captures=new Set<number>();classes=new Set<string>();listeners=new Map<string,Set<(e:any)=>void>>();
 drawCalls:Array<{kind:string;args:unknown[]}>=[];fills=0;integerFills=true;
 classList={toggle:(key:string,on:boolean)=>{if(on)this.classes.add(key);else this.classes.delete(key);}};
 context={fillStyle:'',imageSmoothingEnabled:true,fillRect:(...args:number[])=>{this.fills++;this.integerFills&&=args.every(Number.isInteger);},clearRect:(...args:number[])=>this.drawCalls.push({kind:'clear',args}),setTransform:(...args:number[])=>this.drawCalls.push({kind:'transform',args}),drawImage:(...args:unknown[])=>this.drawCalls.push({kind:'image',args})};
 setAttribute(k:string,v:string){this.attrs.set(k,v);}hasAttribute(k:string){return this.attrs.has(k);}append(e:ObserverElement){this.children.push(e);}prepend(e:ObserverElement){this.children.unshift(e);}remove(){this.removed=true;}focus(){}
 querySelector(selector:string){let e=this.queries.get(selector);if(!e){e=new ObserverElement();if(selector.includes('data-view'))e.dataset.view=selector.includes('iso')?'iso':'2d';this.queries.set(selector,e);}return e;}
 querySelectorAll(){return [this.querySelector('[data-view="2d"]'),this.querySelector('[data-view="iso"]')];}
 closest(selector:string){return selector==='button'||Object.keys(this.dataset).some(key=>selector.includes(key==='animalMap'?'data-animal-map':`data-${key}`))?this:null;}
 getBoundingClientRect(){return this.rect;}getContext(){return this.context;}setPointerCapture(id:number){this.captures.add(id);}hasPointerCapture(id:number){return this.captures.has(id);}releasePointerCapture(id:number){this.captures.delete(id);}
 addEventListener(type:string,fn:(e:any)=>void){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type)!.add(fn);}removeEventListener(type:string,fn:(e:any)=>void){this.listeners.get(type)?.delete(fn);}
 emit(type:string,extra:Record<string,unknown>={}){let stopped=false;const e={target:this,pointerId:1,button:0,isPrimary:true,clientX:160,clientY:200,preventDefault(){},stopImmediatePropagation(){stopped=true;},...extra};for(const fn of this.listeners.get(type)??[]){fn(e);if(stopped)break;}return {stopped};}
}
export function observerPreviewHarness(initialTile:Vec={x:415,y:230},actualScene?:ValleyScene,canvasAvailable=true){
 const app=new ObserverElement(),base=new ObserverElement(),hint=new ObserverElement(),atlas=new ObserverElement(),doc=new ObserverElement(),win=new ObserverElement();
 const follow=new ResidentFollow(),intervals=new Map<number,()=>void>(),covers:boolean[]=[],selections:unknown[]=[],frames:Vec[]=[];let next=0,dispose=()=>{},latest:Snapshot|null=null,roomId:string|null=null,subscriber:((s:Snapshot|null,c:boolean)=>void)|null=null,roomSubscriber:((id:string|null)=>void)|null=null,followSubscriber:((state:ResidentFollowState|null)=>void)|null=null;
 if(actualScene){Object.defineProperty(follow,'state',{get:()=>actualScene.followState});follow.clear=()=>actualScene.stopFollowing();follow.start=(_w,id)=>{actualScene.focusPerson(id);return null;};actualScene.onRoom=b=>{roomId=b?.id??null;roomSubscriber?.(roomId);};actualScene.onFollow=state=>followSubscriber?.(state);}
 let followResolver:ResidentFollowResolver|null=null;
 const stopFollowing=()=>{follow.clear();followSubscriber?.(null);};
 const observerMap={currentSnapshot:()=>latest,currentRoom:()=>roomId,currentTile:()=>initialTile,currentFollow:()=>follow.state,stopFollowing,setFollowResolver:(resolver:ResidentFollowResolver|null)=>{followResolver=resolver;if(actualScene)actualScene.setObserverFollowResolver(resolver);else if(!resolver&&latest){follow.observe(latest.world);notifyFollow();}},frame:(at:Vec)=>{stopFollowing();if(roomId){roomId=null;roomSubscriber?.(null);}frames.push(at);initialTile=at;},cover:(value:boolean)=>covers.push(value),isFullMapTarget:(target:unknown)=>target===atlas,select:(value:unknown)=>{stopFollowing();selections.push(value);},subscribe:(fn:typeof subscriber)=>{subscriber=fn;fn?.(null,false);return ()=>{subscriber=null;};},subscribeRoom:(fn:typeof roomSubscriber)=>{roomSubscriber=fn;fn?.(roomId);return ()=>{roomSubscriber=null;};},subscribeFollow:(fn:typeof followSubscriber)=>{followSubscriber=fn;fn?.(follow.state);return ()=>{followSubscriber=null;};}};
 const warnings:unknown[][]=[];const created:ObserverElement[]=[];const document=Object.assign(doc,{hidden:false,createElement:()=>{const e=new ObserverElement();if(!canvasAvailable)e.getContext=()=>null as any;created.push(e);return e;},getElementById:(id:string)=>id==='app'||id==='observer-hud'?app:base,querySelector:()=>hint});
 const window=Object.assign(win,{setInterval:(fn:()=>void)=>{intervals.set(++next,fn);return next;}});
 let source=readFileSync(new URL('../../src/client/isometric-observer.ts',import.meta.url),'utf8');source=source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 const context:Record<string,unknown>={...preview,residentFollowText,observerMap,document,window,console:{warn:(...args:unknown[])=>warnings.push(args)},Element:ObserverElement,performance:{now:()=>0},clearInterval:(id:number)=>intervals.delete(id),__hot:{dispose:(fn:()=>void)=>{dispose=fn;}}};
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+';this.observerHandle=mountIsometricObserver(observerMap);this.previewModel=this.observerHandle.model;this.remount=()=>mountIsometricObserver(observerMap);',context);
 const handle=context.observerHandle as import('../../src/client/isometric-observer.js').IsometricObserverHandle;dispose=()=>handle.dispose();
 const canvas=app.children[0],tray=app.children[1];
 const notifyFollow=()=>{if(follow.state?.status==='following'&&follow.state.roomId!==roomId){roomId=follow.state.roomId;roomSubscriber?.(roomId);}followSubscriber?.(follow.state);};
 return {model:context.previewModel as preview.IsometricPreview,handle,remount:context.remount as ()=>typeof handle,app,warnings,canvas,tray,document,window,base,hint,atlas,created,covers,selections,frames,intervals,follow,room:()=>roomId,
  accept:(snapshot:Snapshot,connected=true)=>{if(latest?.world.id===snapshot.world.id&&snapshot.world.revision<latest.world.revision)return;const changed=latest&&latest.world.id!==snapshot.world.id;latest=snapshot;if(changed){follow.clear();roomId=null;roomSubscriber?.(null);}if(actualScene)actualScene.accept(snapshot);else follow.observe(snapshot.world,followResolver);notifyFollow();subscriber?.(snapshot,connected);},connection:(value:boolean)=>subscriber?.(latest,value),
  startFollow:(id:string)=>{follow.start(latest!.world,id,followResolver);notifyFollow();},enter:(id:string|null)=>{stopFollowing();roomId=id;roomSubscriber?.(id);},
  toggle:(view='iso')=>tray.emit('click',{target:tray.querySelector(`[data-view="${view}"]`)}),dispose:()=>dispose(),subscribers:()=>[subscriber,roomSubscriber,followSubscriber]};
}
