import type {World} from '../shared/types.js';
import {countValleySpiritFacts,projectValleySpiritFairness,type ValleySpiritProposalDirectionFact} from '../shared/valley-spirit-fairness.js';
import {validMvpFallenFruitSettlementLedger} from '../world/mvp-fallen-fruit-settlement.js';

/** All actual records must come from the same checked sealed SQL head.
 * Independent queue evidence only describes recorded directions. */
export function projectSealedMvpFairness(w:World,directions:readonly ValleySpiritProposalDirectionFact[]|null){
 const missing={status:'unavailable',code:'not-installed'} as const;
 const effects=w.mvpClimate?.spiritEffects;
 const settlement=w.mvpClimate?.spiritFruitSettlement;
 if(settlement!==undefined&&(!effects||!validMvpFallenFruitSettlementLedger(w,settlement)))
  return {status:'unavailable',code:'invalid-actual-facts'} as const;
 const actualEffects=effects?.applied.map(a=>a.receipt)??[];
 const basis={worldId:w.id,actualEffects,actualDiscoveries:settlement?.discoveries??[],actualPickups:settlement?.pickups??[]};
 const actual=projectValleySpiritFairness({...basis,proposalDirections:[]});
 if(actual.status!=='ready')return {status:'unavailable',code:'invalid-actual-facts'} as const;
 const proposals=directions?projectValleySpiritFairness({...basis,proposalDirections:directions}):null;
 const total=actual.actualEffects.count,picked=actual.actualPickups.count;
 return {
  status:'ready',audience:'internal-audit',schemaVersion:1,worldId:w.id,throughRevision:w.revision,throughMinute:w.minute,
  proposalDirections:proposals?.status==='ready'?{
   status:'ready',coverage:'present-stable-sidecar-only',...proposals.proposalDirections,
  }:{status:'unavailable',code:'no-coherent-proposal-sidecar'},
  actualEffects:effects?{status:'ready',...actual.actualEffects}:missing,
  actualDiscoveries:settlement?{status:'ready',...actual.actualDiscoveries}:missing,
  actualPickups:settlement?{status:'ready',...actual.actualPickups}:missing,
  supply:{
   item:'fruit',fallTransfer:effects?{status:'ready',sourceDebit:total,groundCredit:total,directNewSupply:0,
    bySource:countValleySpiritFacts(actualEffects,e=>e.sourceResourceInstanceId)}:missing,
   pickupTransfer:settlement?{status:'ready',groundDebit:picked,residentCredit:picked}:missing,
   naturalRenewal:{status:'unavailable',code:'not-recorded-by-effect-custody'},
   causalGain:{status:'unavailable',code:'requires-counterfactual'},
  },
 } as const;
}
