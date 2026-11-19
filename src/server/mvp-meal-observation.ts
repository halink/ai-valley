import {readMvpMealFact,type MvpMealFact} from '../shared/mvp-meals.js';
import type {World} from '../shared/types.js';

type Attributed<K extends MvpMealFact['kind']>=Extract<MvpMealFact,{kind:K}>&{at:number};
type ResidentMeals={cooked:Attributed<'cooked'>|null;ate:Attributed<'ate'>|null};

export function mvpMealObservation(w:World){
 const people=new Map<string,ResidentMeals>(w.residents.map(r=>[r.id,{cooked:null,ate:null}]));
 if(w.mode==='validation'){
  // The observer gets only a bounded summary of the last 512 world events.
  // No previous cooking/meal link or model affordance is derived here.
  const start=Math.max(0,w.events.length-512);
  for(let i=w.events.length-1;i>=start;i--){
   const e=w.events[i];
   if(e.actors.length!==1||e.observerOnly||!Number.isFinite(e.at)||e.at<0||e.at>w.minute)continue;
   const p=people.get(e.actors[0]),f=readMvpMealFact(e.mvpMeal);
   if(!p||!f)continue;
   if(f.kind==='ate'&&e.kind==='action'&&!e.agriculture&&!p.ate)p.ate={...f,at:e.at};
   if(f.kind==='cooked'&&e.kind==='production'&&!p.cooked){
    const a=e.agriculture;
    const receipt=a&&Object.hasOwn(w.mvpAgriculture?.receipts??{},a.executionId)?w.mvpAgriculture!.receipts[a.executionId]:undefined;
    if(a?.operation==='cook'&&a.cultivar===f.cultivar&&receipt?.actorId===e.actors[0]&&receipt.eventId===e.id&&receipt.operation==='cook'&&receipt.cultivar===f.cultivar)
     p.cooked={...f,at:e.at};
   }
  }
 }
 return {schemaVersion:1 as const,atMinute:w.minute,residents:Object.fromEntries(people)};
}
