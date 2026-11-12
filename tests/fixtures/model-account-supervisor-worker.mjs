// Fixed network-free fixture. No environment, file, model, or credential reads.
const [scenario,...extra]=process.argv.slice(2);
if(extra.length||Object.keys(process.env).length||!['clean','fail','block'].includes(scenario))throw Error('fixture_only');
if(scenario==='fail')process.exitCode=1;
if(scenario==='block')for(;;){}
