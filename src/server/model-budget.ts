import type {ModelCharge} from '../shared/types.js';

const WINDOW=60_000;

export class ModelBudget {
 private charges:ModelCharge[];
 constructor(private readonly rpm:number|null,private readonly tpm:number|null,saved:ModelCharge[]=[],now=Date.now()){
  // An interrupted request may have been billed. Retain its estimate for the next window.
  this.charges=saved.map(charge=>({...charge,finishedAt:charge.finishedAt??now}));
  this.prune(now);
 }

 reserve(now:number,input:number,output:number):ModelCharge|null{
  this.prune(now);
  const start=now-WINDOW;
  let requests=0,tokens=0;
  for(const charge of this.charges){
   if(charge.startedAt>start)requests++;
   if(charge.startedAt>start||charge.finishedAt===undefined)tokens+=charge.input;
   if(charge.finishedAt===undefined||charge.finishedAt>start)tokens+=charge.output;
  }
  if(this.rpm!==null&&requests>=this.rpm||this.tpm!==null&&tokens+input+output>this.tpm)return null;
  const charge={startedAt:now,input,output};
  this.charges.push(charge);
  return charge;
 }

 finish(charge:ModelCharge,now:number,usage?:{inputTokens:number;outputTokens:number}){
  charge.finishedAt=now;
  // A missing usage report keeps the conservative reservation.
  if(usage?.inputTokens&&Number.isSafeInteger(usage.inputTokens)&&usage.inputTokens>0)charge.input=usage.inputTokens;
  if(usage?.outputTokens&&Number.isSafeInteger(usage.outputTokens)&&usage.outputTokens>0)charge.output=usage.outputTokens;
 }

 snapshot():ModelCharge[]{return this.charges.map(charge=>({...charge}));}

 private prune(now:number){this.charges=this.charges.filter(charge=>charge.finishedAt===undefined||Math.max(charge.startedAt,charge.finishedAt)>now-WINDOW);}
}
