#!/usr/bin/env node
// Isolated synthetic run. No keys, live database, network or model invocation.
import {mkdtempSync,rmSync} from 'node:fs';
import {testTmpdir} from './repository-temporary.mjs';
import {join} from 'node:path';
import {runNineResidentFoodChain} from '../tests/helpers/nine-resident-food-chain.js';
if(process.argv.slice(2).join(' ')!=='--offline'){
 console.error('Usage: node --import tsx scripts/acceptance-nine-food-chain.mjs --offline');process.exitCode=2;
}else{
 const directory=mkdtempSync(join(testTmpdir(),'nine-food-chain-'));
 try{console.log(JSON.stringify(runNineResidentFoodChain(join(directory,'synthetic.sqlite')),null,2));}
 finally{rmSync(directory,{recursive:true,force:true});}
}
