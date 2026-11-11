import assert from 'node:assert/strict';
import type {Resident,World} from '../../src/shared/types.js';
import {advanceMigration,applyOutsideDecision} from '../../src/world/migration.js';

/** Test-only explicit decisions. Production never auto-continues a walking stage. Stops at a blocked gate. */
export function finishChosenVisit(w:World,r:Resident):void {
 let limit=100;
 while(r.residency==='outside'){
  assert.ok(limit--,'bounded test journey');const c=w.migration!.contacts.find(c=>c.id===r.id)!;
  if(!c.journey)break;
  const j=c.journey.staged;
  if(j?.status==='waiting'){
   if(c.journey.blocked)break;
   assert.ok(applyOutsideDecision(w,r.id,r.revision,{intention:'测试中本人明确选择下一段',actions:[{type:'visitorJourney',operation:'continue',journeyId:j.id,minutes:Math.min(30,j.duration/2)}]}).ok);
  }
  w.minute+=j?Math.max(1,j.stageRemaining):Math.max(1,c.journey.nextCheckAt-w.minute);advanceMigration(w);
 }
}
