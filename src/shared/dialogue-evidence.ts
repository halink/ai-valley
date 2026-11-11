import {readSpeechTone} from './speech-tone.js';
import type {Memory} from './types.js';

/** Keep source text as quoted data. JSON escapes preserve line breaks and
 * controls without letting a recollection create new prompt roles or rows. */
export function quoteDialogue(value:string):string {
 return JSON.stringify(value).replace(/[<>&`\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,char=>char.split('').map(unit=>'\\u'+unit.charCodeAt(0).toString(16).padStart(4,'0')).join(''));
}
export function dialogueExcerpt(value:unknown,limit:number):string {
 if(typeof value!=='string'||!value.length)return '记录缺失，内容未知';
 let end=Math.min(value.length,limit);
 if(end<value.length&&/[\uD800-\uDBFF]/.test(value[end-1]??''))end--;
 return quoteDialogue(value.slice(0,end))+(end<value.length?'…（已省略；仅节录）':'');
}
export function dialogueSource(source:unknown):string {
 return source==='self'?'本人参与的经历':source==='witness'?'本人现场获知的经历':source==='heard'?'本人收到的消息（不等于已经核实）':'来源未知';
}
export function dialogueTone(memory:Memory):string {
 const tone=readSpeechTone(memory.speechTone);
 return tone?'实际发言语气：'+tone:'发言语气未记录（未知）';
}
export function shortMemory(memory:Memory):string {
 const tone=readSpeechTone(memory.speechTone);
 return `${dialogueSource(memory.source)}：${dialogueExcerpt(memory.text,120)}${tone?'；实际发言语气：'+tone:''}`;
}
