export const physiologyDefaults={hungerPerMinute:.038,energyPerMinute:.025,hungerDanger:95,hungerHealthDrain:.045,energyDanger:2,energyHealthDrain:.015,sleepEnergy:.22,sleepFedThreshold:80,sleepHealth:.008,infantRest:.1,elderYears:65,yearlyHazard:.012,hazardDoublingYears:7,laterLifeSleepLoss:0,laterLifeSleepYears:20};
export type PhysiologyRules=typeof physiologyDefaults;

/** Candidate recovery-only version. Activation and new-resident binding stay gated by the survival baseline. */
export const laterLifePhysiologyDefaults={...physiologyDefaults,laterLifeSleepLoss:.25};
/** Bounded gradual sleep adaptation; never changes capacity, work eligibility or age mortality. */
export function laterLifeSleepFactor(age:number,rules:Pick<PhysiologyRules,'elderYears'|'laterLifeSleepLoss'|'laterLifeSleepYears'>):number {
 const loss=Number.isFinite(rules.laterLifeSleepLoss)?Math.max(0,Math.min(.25,rules.laterLifeSleepLoss)):0;
 const span=Number.isFinite(rules.laterLifeSleepYears)?Math.max(1,rules.laterLifeSleepYears):20;
 return 1-loss*Math.max(0,Math.min(1,(age-rules.elderYears)/span));
}
