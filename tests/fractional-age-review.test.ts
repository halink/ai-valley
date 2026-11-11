import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ageYears,DAY,YEAR} from '../src/world/time.js';
import {ageMortalityDue} from '../src/world/life.js';
import {physiologyDefaults} from '../src/shared/physiology.js';
import type {Resident} from '../src/shared/types.js';

// Adjacent actual binary64 dates, not a guessed decimal epsilon.
function adjacent(value:number,direction:1|-1):number {
 if(value===0)return direction*Number.MIN_VALUE;
 const buffer=new ArrayBuffer(8),view=new DataView(buffer);
 view.setFloat64(0,value);
 view.setBigUint64(0,view.getBigUint64(0)+(value>0?BigInt(direction):-BigInt(direction)));
 return view.getFloat64(0);
}

function assertBirthday(bornAt:number,years:number){
 const birthday=bornAt+years*YEAR;
 assert.ok(ageYears(bornAt,adjacent(birthday,-1))<years,`before ${years}: born ${bornAt}, birthday ${birthday}`);
 assert.ok(ageYears(bornAt,birthday)>=years,`at ${years}: born ${bornAt}, birthday ${birthday}`);
 assert.ok(ageYears(bornAt,adjacent(birthday,1))>=years,`after ${years}: born ${bornAt}, birthday ${birthday}`);
}

for(const years of [6,13,18,65]){
 test(`negative seed cannot cross ${years} at the preceding representable date`,()=>{
  const bornAt=1-years*YEAR;
  assert.equal((adjacent(1,-1)-bornAt)/YEAR,years,'fixture demonstrates subtraction rounding');
  assertBirthday(bornAt,years);
 });

 for(const step of [.25,1.2])test(`fractional ${step} clock births preserve ${years} birthday boundaries`,()=>{
  let bornAt=0;
  for(let i=0;i<1001;i++)bornAt+=step;
  assertBirthday(bornAt,years);
  const birthday=bornAt+years*YEAR;
  let minute=birthday-2*step;
  for(let i=0;i<5;i++,minute+=step){
   assert.equal(ageYears(bornAt,minute)>=years,minute>=birthday,`step date ${minute}`);
  }
 });

 for(const base of [1e9,1e12])test(`large date ${base} preserves ${years} birthday boundaries`,()=>{
  assertBirthday(base+.1,years);
 });

 // Crossing an exponent boundary changes the spacing of representable dates.
 // An age-only epsilon misses these even though every timestamp is safe.
 for(const exponent of [30,40,52])test(`safe exponent boundary 2**${exponent} preserves ${years} birthday`,()=>{
  assertBirthday(2**exponent-years*YEAR+(exponent===52?.5:.1),years);
 });
}

const invalidCases:Array<[string,unknown,unknown]>=[
 ['NaN birth',NaN,20*YEAR],['NaN date',0,NaN],
 ['negative infinite birth',-Infinity,0],['positive infinite birth',Infinity,0],
 ['positive infinite date',0,Infinity],['negative infinite date',0,-Infinity],
 ['null birth',null,20*YEAR],['null date',-20*YEAR,null],
 ['string birth','0',20*YEAR],['string date',0,String(20*YEAR)],
 ['overflowing elapsed',-Number.MAX_VALUE,Number.MAX_VALUE],
 ['unsafe birth',-Number.MAX_SAFE_INTEGER-1,0],
 ['unsafe date',0,Number.MAX_SAFE_INTEGER+1],
 ['unsafe elapsed',-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER],
 ['future birth',10,9],
];
for(const [label,bornAt,minute] of invalidCases)test(`${label} cannot grant adult age`,()=>{
 const age=ageYears(bornAt as number,minute as number);
 assert.equal(age,0);
 assert.equal(age>=18,false);
 assert.equal(age<18,true,'existing underage rejection guards must close');
 // This does not establish conservative guardian/infant authorization:
 // those require separate validity checks, outside this boundary repair.
});

test('ordinary continuous age remains continuous away from integer birthdays',()=>{
 for(const bornAt of [-30*YEAR,0,1234.567,1e12+.1]){
  const minute=bornAt+18.375*YEAR;
  assert.equal(ageYears(bornAt,minute),(minute-bornAt)/YEAR);
 }
});

test('fractional elder birthday does not schedule mortality between daily samples',()=>{
 // Force a risk of one to test sample timing without relying on a lucky hash.
 const rules={...physiologyDefaults,yearlyHazard:1e6};
 const person={id:'fractional-mortality-review',status:'alive',bornAt:DAY-65*YEAR+.1} as Resident;
 const birthday=person.bornAt+65*YEAR;
 assert.ok(birthday>DAY);
 assert.equal(ageMortalityDue(42,person,DAY-.25,DAY,rules),false,'daily sample still precedes elder birthday');
 assert.equal(ageMortalityDue(42,person,DAY,birthday+.25,rules),false,'birthday itself is not a new mortality sample');
 assert.equal(ageMortalityDue(42,person,birthday+.25,2*DAY-.25,rules),false);
 assert.equal(ageMortalityDue(42,person,2*DAY-.25,2*DAY,rules),true,'next daily sample uses attained elder age');
 assert.equal(ageMortalityDue(42,person,2*DAY-.25,2*DAY,rules),true,'same sample is replay deterministic');
 person.status='dead';
 assert.equal(ageMortalityDue(42,person,2*DAY-.25,2*DAY,rules),false);
});
