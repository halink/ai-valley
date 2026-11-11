import type {Memory} from './types.js';

// Match the existing personal memory retention, not the observer archive.
// The last 80 delivered entries are authoritative. Older legacy excess is
// ignored, not migrated or restored; duplicates add no new candidate slot.
export const MAX_RETAINED_INTERPRETATION_MEMORIES=80;
export const MAX_INTERPRETATION_MEMORIES=5;
export const MAX_INTERPRETATION_TARGETS=2;
export const INTERPRETATION_ROTATION_MINUTES=30;

export function retainedInterpretationMemories(memories:Memory[],minute:number):Memory[]{
 const unique=new Map<string,Memory>();
 for(const memory of memories.slice(-MAX_RETAINED_INTERPRETATION_MEMORIES)){
  if(typeof memory.eventId!=='string'||!memory.eventId||!Number.isFinite(memory.receivedAt)||memory.receivedAt>minute)continue;
  // The last actually retained delivery wins as one complete record. Never
  // splice text/tone from an older duplicate or from the global event ledger.
  unique.delete(memory.eventId);unique.set(memory.eventId,memory);
 }
 return [...unique.values()];
}
