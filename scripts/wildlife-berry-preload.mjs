// Explicit preload for the guarded synthetic offline longevity harness only.
// Not loaded by production runtime; observes static bushes across daily SQLite reloads.
// Use --import ./scripts/wildlife-berry-preload.mjs after guard and tsx; see observer scope.
import {appendFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {WorldStore} from '../src/server/store.js';
import {createBerryObserver} from './wildlife-berry-observer.mjs';
const args=process.argv.slice(2),output=args[args.indexOf('--output')+1];
if(!output||!globalThis.__valleyOfflineGuard)throw Error('isolated observer needs guarded harness output');
const observers=new Map();
function observer(w){let o=observers.get(w.seed);if(!o){o=createBerryObserver(e=>appendFileSync(resolve(output,`seed-${w.seed}`,'berry-changes.jsonl'),JSON.stringify(e)+'\n'));observers.set(w.seed,o);}o.attach(w);return o;}
const commit=WorldStore.prototype.commit,load=WorldStore.prototype.loadForRuntime;
WorldStore.prototype.commit=function(w,...args){observer(w);const result=commit.call(this,w,...args);writeFileSync(resolve(output,`seed-${w.seed}`,'berry-summary.json'),JSON.stringify({seed:w.seed,minute:w.minute,...observer(w).snapshot()},null,2));return result;};
WorldStore.prototype.loadForRuntime=function(...args){const w=load.apply(this,args);if(w)observer(w);return w;};
