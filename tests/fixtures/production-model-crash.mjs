// Synthetic subprocess only: parent supplies a newly-created repository fixture.
import {DatabaseSync} from 'node:sqlite';
import {ProductionModelJournal,productionCandidateContract,modelEvidenceHash} from '../../src/server/production-model-journal.ts';
globalThis.fetch=()=>{throw new Error('network_prohibited');};
const contract=productionCandidateContract({runId:'synthetic-run',worldId:'synthetic-world',maxRequests:2,createdAtMs:1000,deadlineAtMs:11000,requestTimeoutMs:1000});
const db=new DatabaseSync(process.argv[2]);
const journal=new ProductionModelJournal(db,contract,{create:false,worldFingerprint:'a'.repeat(64)});
const id=journal.intent(modelEvidenceHash('synthetic_request'),1000);
if(process.argv[3]==='response')journal.response(id,modelEvidenceHash('synthetic_response'),1000);
process.send?.('durable');
setInterval(()=>{},1000);
