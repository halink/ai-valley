import {createHash} from 'node:crypto';
import {createValleySpiritAlmanacPacket,type ValleySpiritAlmanacAuthority,type ValleySpiritAlmanacPacket,type ValleySpiritAlmanacRange} from './valley-spirit-almanac.js';

type Point=ValleySpiritAlmanacPacket['points'][number];
const MENU_VERSION=1 as const;
const COVERAGE='actual-selected-weather-points' as const;
const LABELS={
 'weather-point':'一个实际时点的天气',
 'temperature-point':'一个实际时点的气温',
 'humidity-point':'一个实际时点的相对湿度',
 'temperature-two-points':'比较两个实际时点的气温',
 'humidity-two-points':'比较两个实际时点的相对湿度',
} as const;
type TopicKind=keyof typeof LABELS;
interface Evidence {
 sourceRef:string;
 minute:number;
 field:'condition'|'temperatureDeciC'|'relativeHumidityPermille';
 value:string|number;
}
export interface ValleySpiritAlmanacTopic {
 topicId:string;
 kind:TopicKind;
 label:typeof LABELS[TopicKind];
 evidence:Evidence[];
}
export interface ValleySpiritAlmanacTopicMenu {
 menuVersion:1; menuId:string;
 projectionVersion:1; permissionVersion:number; worldId:string;
 fromMinute:number; throughMinute:number;
 coverage:typeof COVERAGE;
 unselectedHourBuckets:number[];
 candidates:ValleySpiritAlmanacTopic[];
}
export interface ValleySpiritAlmanacTopicSelection {
 menuVersion:1;menuId:string;projectionVersion:1;permissionVersion:number;worldId:string;
 selectedBy:'synthetic-offline'|'manual';
 coverage:typeof COVERAGE;
 topic:ValleySpiritAlmanacTopic;
}
function fieldForKind(kind:TopicKind){
 return kind.startsWith('temperature-')?'temperatureDeciC':kind.startsWith('humidity-')?'relativeHumidityPermille':'condition';
}
function topicSpecs(pair:boolean):ReadonlyArray<readonly [TopicKind,readonly ('oldest'|'latest')[]]>{
 const single=[['weather-point',['latest']],['temperature-point',['latest']],['humidity-point',['latest']]] as const;
 return pair?[...single,['temperature-two-points',['oldest','latest']],['humidity-two-points',['oldest','latest']]]:single;
}

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function topic(kind:TopicKind,points:readonly Point[],packetFingerprint:string):ValleySpiritAlmanacTopic{
 const field=fieldForKind(kind);
 const evidence:Evidence[]=points.map(p=>({sourceRef:p.sourceRef,minute:p.minute,field,value:p[field]}));
 return {topicId:'valley-topic-'+hash([MENU_VERSION,packetFingerprint,kind,evidence]),kind,label:LABELS[kind],evidence};
}
function menuNow(range:ValleySpiritAlmanacRange,authority:ValleySpiritAlmanacAuthority):ValleySpiritAlmanacTopicMenu|null {
 const packet=createValleySpiritAlmanacPacket(range,authority);
 if(!packet)return null;
 const fingerprint=hash(packet),points=packet.points,oldest=points[0],latest=points.at(-1)!;
 const sites={oldest,latest};
 const candidates=topicSpecs(oldest!==latest).map(([kind,targets])=>topic(kind,targets.map(k=>sites[k]),fingerprint));
 return {menuVersion:MENU_VERSION,menuId:'valley-topics-'+hash([MENU_VERSION,fingerprint,candidates.map(c=>c.topicId)]),projectionVersion:packet.projectionVersion,permissionVersion:packet.permissionVersion,worldId:packet.worldId,fromMinute:packet.fromMinute,throughMinute:packet.throughMinute,coverage:COVERAGE,unselectedHourBuckets:[...packet.unselectedHourBuckets],candidates};
}
function readSelection(value:unknown):{menuId:string;topicId:string}|null{
 if(!record(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'menuId')||!Object.hasOwn(value,'topicId'))return null;
 if(typeof value.menuId!=='string'||!/^valley-topics-[a-f0-9]{64}$/.test(value.menuId)||typeof value.topicId!=='string'||!/^valley-topic-[a-f0-9]{64}$/.test(value.topicId))return null;
 return {menuId:value.menuId,topicId:value.topicId};
}
function currentChoice(menu:ValleySpiritAlmanacTopicMenu|null,answer:unknown,selectedBy:ValleySpiritAlmanacTopicSelection['selectedBy']):ValleySpiritAlmanacTopicSelection|null {
 const v=readSelection(answer);
 if(!v||!menu||v.menuId!==menu.menuId)return null;
 const candidate=menu.candidates.find(c=>c.topicId===v.topicId);
 if(!candidate)return null;
 return {menuVersion:MENU_VERSION,menuId:menu.menuId,projectionVersion:menu.projectionVersion,permissionVersion:menu.permissionVersion,worldId:menu.worldId,coverage:COVERAGE,selectedBy,topic:candidate};
}
/** G1 selection is a read, not a proposal, a published almanac, or world authority.
 * The caller supplies requested refs; only the live authority supplies values.
 * No world/write/scheduling/production transport capability enters this boundary. */
export class ValleySpiritAlmanacTopics {
 constructor(private readonly authority:ValleySpiritAlmanacAuthority){}
 preview(range:ValleySpiritAlmanacRange):ValleySpiritAlmanacTopicMenu|null{
  return menuNow(range,this.authority);
 }
 validateManualChoice(range:ValleySpiritAlmanacRange,answer:unknown):ValleySpiritAlmanacTopicSelection|null{
  return currentChoice(menuNow(range,this.authority),answer,'manual');
 }
 /** Deterministic local stand-in; no callback or model transport exists here.
  * A real model chooser requires shared admission/authorization/usage recovery
  * before future wiring. The stand-in behaves like an untrusted answer parser. */
 simulateOfflineChoice(range:ValleySpiritAlmanacRange,index:number):ValleySpiritAlmanacTopicSelection|null{
  if(!Number.isSafeInteger(index)||index<0)return null;
  const menu=menuNow(range,this.authority),candidate=menu?.candidates[index];
  if(!menu||!candidate)return null;
  return currentChoice(menuNow(range,this.authority),{menuId:menu.menuId,topicId:candidate.topicId},'synthetic-offline');
 }
}

/** Pure presentation for the private owner after separate exact grants are
 * validated. No public archive authority and no persistent identifiers. */
export function nativeSeasonalWeatherPairMenu(early:Omit<Point,'sourceRef'>,late:Omit<Point,'sourceRef'>){
 if(!Number.isSafeInteger(early.minute)||!Number.isSafeInteger(late.minute)||early.minute%60!==0||late.minute!==early.minute+60)return null;
 const sites={oldest:{point:early,ref:'point-1'},latest:{point:late,ref:'point-2'}} as const;
 return Object.freeze({menuVersion:1 as const,coverage:COVERAGE,options:Object.freeze(topicSpecs(true).map(([kind,targets],index)=>{
  const field=fieldForKind(kind);
  return Object.freeze({number:index+1,kind,evidence:Object.freeze(targets.map(k=>{
   const {ref,point}=sites[k];
   return Object.freeze({ref,observedMinute:point.minute,field,value:point[field]});
  }))});
 }))});
}
