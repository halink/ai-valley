import type {Action,Resident,World,WorldEvent} from '../shared/types.js';
import {readSpeechText,readSpeechTone,type SpeechTone} from '../shared/speech-tone.js';
import {emitEvent} from './events.js';
import {canObserve} from './knowledge.js';
import {distance} from './navigation.js';
import {canContactSocialTarget,canSeeSocialTarget} from './social-observation.js';

type TalkAction=Extract<Action,{type:'talk'}>;
/** In-process staging only. No World, public event, memory, or save field holds this receipt. */
export interface AddressedSpeechReceipt {
 readonly schemaVersion:1;
 readonly kind:'addressed-speech-delivered';
 readonly worldId:string;
 readonly eventId:string;
 readonly eventRevision:number;
 readonly planId:string;
 readonly actionType:'talk';
 /** Remaining queued actions after this action starts, unique within this plan. */
 readonly actionIndexFromEnd:number;
 readonly startedAt:number;
 readonly deliveredAt:number;
 readonly speakerId:string;
 readonly intendedRecipientId:string;
 readonly actualRecipientId:string;
 readonly line:string;
 readonly tone?:SpeechTone;
}
export interface AddressedSpeechObservation {
 readonly worldId:string;
 readonly previousRevision:number;
 readonly committedCandidateRevision:number;
 readonly fromMinute:number;
 readonly toMinute:number;
 readonly receipts:readonly AddressedSpeechReceipt[];
}
const active=new WeakMap<World,AddressedSpeechReceipt[]>();
const capturedOn=new WeakMap<AddressedSpeechObservation,World>();

/** Bind capture to this exact draft object and its step. A throwable step
 * yields nothing; callers still must durably commit before retaining evidence. */
export function captureAddressedSpeech(w:World,advance:()=>void):AddressedSpeechObservation {
 if(active.has(w))throw Error('addressed_speech_capture_already_active');
 const previousRevision=w.revision,fromMinute=w.minute,receipts:AddressedSpeechReceipt[]=[];
 active.set(w,receipts);
 try {
  advance();
  const observation:AddressedSpeechObservation=Object.freeze({worldId:w.id,previousRevision,
   committedCandidateRevision:w.revision,fromMinute,toMinute:w.minute,receipts:Object.freeze(receipts)});
  if(!w.simulationOnly&&w.revision>previousRevision&&w.minute>fromMinute)capturedOn.set(observation,w);
  return observation;
 }finally{active.delete(w);}
}
export function isCurrentAddressedSpeechObservation(w:World,observation:AddressedSpeechObservation):boolean {
 return capturedOn.get(observation)===w&&!w.simulationOnly&&observation.worldId===w.id&&
  observation.committedCandidateRevision===w.revision&&observation.toMinute===w.minute;
}

function awakeForSpeech(w:World,recipient:Resident):boolean {
 return recipient.health>0&&canObserve(w,recipient);
}
/** The ordinary talk recipient receives exactly one line by this channel.
 * A generic event, actor list, witness radius, or memory scan cannot deliver it. */
function deliverLine(w:World,speaker:Resident,recipient:Resident,event:WorldEvent,line:string,tone:SpeechTone|undefined):void {
 const speechText=readSpeechText(line);
 recipient.memories.push({eventId:event.id,receivedAt:w.minute,source:'heard',text:`${speaker.name}：${line}`,
  ...(speechText!==undefined?{speechText}:{}),...(tone?{speechTone:tone}:{})});
 if(recipient.memories.length>80)recipient.memories.splice(0,recipient.memories.length-80);
 if(!recipient.knownPeople.includes(speaker.id))recipient.knownPeople.push(speaker.id);
}

export function completeAddressedSpeech(w:World,speaker:Resident,action:TalkAction):string|null {
 const target=w.residents.find(v=>v.id===action.targetId),activity=speaker.activity,plan=speaker.plan;
 if(!target||!activity||activity.action!==action||activity.remaining>0||!plan||plan.id!==activity.planId||
   activity.path.length||activity.room?.path.length||!speaker.canExpress||!awakeForSpeech(w,speaker)||
   !canContactSocialTarget(w,speaker,target))return '对方已经不在能够交谈的位置';
 const line=typeof action.text==='string'?action.text.slice(0,320):'';
 if(!line.trim())return '发言没有可传达的内容';
 if(!awakeForSpeech(w,target)||!canSeeSocialTarget(w,target,speaker)){
  // A present but unperceiving target is not a world fault or successful talk.
  // The actor performed an attempt, but no recipient knowledge is produced.
  emitEvent(w,{kind:'action',actors:[speaker.id],witnesses:[speaker.id],place:{...speaker.at},
   text:`${speaker.name}的当面发言没有传达到指定听者。`});
  return null;
 }
 const previous=[...w.events].reverse().find(e=>e.kind==='conversation'&&e.conversationId?.startsWith('conversation-')&&
  (e.roomId??null)===speaker.inside&&e.actors.includes(speaker.id)&&e.actors.includes(target.id)&&w.minute-e.at<45&&
  (speaker.inside?!!e.roomAt&&!!speaker.roomAt&&distance(e.roomAt,speaker.roomAt)<5:distance(e.place,speaker.at)<5));
 const conversationId=previous?.conversationId??`conversation-${w.id}-${w.revision+1}`;
 const tone=readSpeechTone(action.tone),speechText=readSpeechText(line);
 // Keep the pre-existing observer chronology, but the generic event records
 // only the speaker's own experience. It never grants the line to witnesses.
 const event=emitEvent(w,{kind:'conversation',actors:[speaker.id,target.id],witnesses:[speaker.id],place:{...speaker.at},
  conversationId,...(tone?{speechTone:tone}:{}),...(speechText!==undefined?{speechText}:{}),text:`${speaker.name}：${line}`});
 deliverLine(w,speaker,target,event,line,tone);
 if(!w.simulationOnly)active.get(w)?.push(Object.freeze({schemaVersion:1,kind:'addressed-speech-delivered',
  worldId:w.id,eventId:event.id,eventRevision:w.revision,planId:activity.planId,actionType:'talk',
  actionIndexFromEnd:plan.actions.length,startedAt:activity.startedAt,deliveredAt:w.minute,
  speakerId:speaker.id,intendedRecipientId:action.targetId,actualRecipientId:target.id,line,...(tone?{tone}:{})}));
 // Evidence can be interpreted by the listener; never decide what they meant.
 for(const [from,to] of [[speaker,target],[target,speaker]]){
  let relation=from.relations.find(v=>v.targetId===to.id);
  if(!relation){relation={targetId:to.id,affection:0,trust:0,conflict:0,evidence:[]};from.relations.push(relation);}
  relation.evidence.push(event.id);if(relation.evidence.length>80)relation.evidence=relation.evidence.slice(-80);
 }
 if(!target.plan&&!target.activity)target.decisionDue=Math.min(target.decisionDue,w.minute);
 return null;
}
