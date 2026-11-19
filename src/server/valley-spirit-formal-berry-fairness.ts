import type {World} from '../shared/types.js';
import {countValleySpiritFacts} from '../shared/valley-spirit-fairness.js';
import {validateFormalGroundBerryFoodBirth,type FormalBerryFixtureEffect} from './valley-spirit-formal-berry-authority.js';

/** Private projection of already-verified, same-save SQL archive rows. Never a
 * public API, a resident view, or authorization for a subsequent effect. */
export function projectCommittedFormalBerryFairness(w:World,rows:readonly FormalBerryFixtureEffect[]){
 const effects=rows.map(({receipt:r,committedRevision})=>({
  supplyReceiptId:r.draftId,sourceId:r.sourceId,target:{...r.target},rainEpisodeId:r.rain.episodeId,
  at:r.placedMinute,committedRevision,
 }));
 const settlements=rows.flatMap(({receipt,pickup:p})=>p?[{
  supplyReceiptId:receipt.draftId,residentId:p.residentId,observationId:p.observationId,observedAt:p.observedAt,
  observedRevision:p.observedRevision,settledAt:p.pickedAt,settledRevision:p.committedRevision,
 }]:[]);
 // Old signed v1 births were legitimate transfers, but have no freshness
 // authority. An unknown original life must not become a retained stock count.
 const classified={picked:0,unpickedFresh:0,unpickedExpired:0,unpickedFreshnessUnavailable:0};
 for(const row of rows){
  if(row.pickup)classified.picked++;
  else if(!row.foodBirth||!validateFormalGroundBerryFoodBirth(w,row))classified.unpickedFreshnessUnavailable++;
  else if(w.minute>=row.foodBirth.expiresAt)classified.unpickedExpired++;
  else classified.unpickedFresh++;
 }
 return {
  status:'ready',audience:'internal-audit',schemaVersion:1,worldId:w.id,throughRevision:w.revision,throughMinute:w.minute,
  proposalDirections:{status:'unavailable',code:'no-formal-proposal-custody'},
  actualEffects:{status:'ready',count:effects.length,records:effects,
   byTarget:countValleySpiritFacts(effects,e=>'ground:'+e.target.x+':'+e.target.y)},
  actualDiscoveries:{status:'partial',code:'independent-discovery-not-recorded',confirmedOnSettlement:{
   count:settlements.length,byResident:countValleySpiritFacts(settlements,p=>p.residentId),
   records:settlements.map(({supplyReceiptId,residentId,observationId,observedAt,observedRevision})=>
    ({supplyReceiptId,residentId,observationId,observedAt,observedRevision})),
  }},
  actualPickups:{status:'ready',count:settlements.length,byResident:countValleySpiritFacts(settlements,p=>p.residentId),
   records:settlements.map(({supplyReceiptId,residentId,observationId,settledAt,settledRevision})=>
    ({supplyReceiptId,residentId,observationId,settledAt,settledRevision}))},
  supply:{item:'berry',sourceDebit:effects.length,groundCredit:effects.length,directNewSupply:0,
   groundDebitOnPickup:settlements.length,residentCreditOnPickup:settlements.length,
   groundBirthDisposition:classified,
   naturalRenewal:{status:'unavailable',code:'not-measured-by-formal-effect-custody'},
   incrementalRenewalAttribution:{status:'unavailable',code:'requires-counterfactual'},
  },
 } as const;
}
