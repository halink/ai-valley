/** A performed way of speaking, not an emotion or a listener's interpretation.
 * Missing/invalid legacy data stays unknown; never infer tone from the words. */
export type SpeechTone='friendly'|'neutral'|'hostile';
export function readSpeechTone(value:unknown):SpeechTone|undefined {
 return value==='friendly'||value==='neutral'||value==='hostile'?value:undefined;
}
/** New structured utterances cover the normal numbered action's 240 UTF-16
 * unit allowance, without a name prefix. Older unstructured text is not parsed. */
export function readSpeechText(value:unknown):string|undefined {
 return typeof value==='string'&&value.length>0&&value.length<=240&&value.trim()?value:undefined;
}
