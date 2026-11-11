/** A coarse, momentary sign, never a diagnosis, consent or a care entitlement. */
export type BodySign='choice-support'|'expression-support'|'hunger'|'exhaustion'|'weakness'|'sleeping';
export interface BodyObservation {atMinute:number;signs:BodySign[];}
export const bodySignLabels:Record<BodySign,string>={
 'choice-support':'自主应对受限，需当面核实本人的选择能力',
 'expression-support':'表达受限；不能据此认定没有决定能力或已经同意',
 hunger:'有明显饥饿迹象',exhaustion:'显得十分疲惫',weakness:'身体显得虚弱',sleeping:'正在睡眠，不能据此判断失能或照护需要'
};
