import type {Resident,World} from '../shared/types.js';
export type PersonPose='idle'|'sleep'|'work'|'ill'|'carried'|'celebrate'|'fish'|'shoreRest'|'hunt';
export function personPose(w:World,r:Resident):PersonPose{
 if(r.status==='dead')return 'idle';
 if(w.health?.transports.some(t=>t.patientId===r.id&&t.phase==='carrying'))return 'carried';
 const activity=r.activity,a=activity?.action,working=!!activity&&!activity.path.length&&!activity.room?.path.length&&activity.room?.mode!=='exit';
 if(working&&a?.type==='sleep')return 'sleep';
 if(working&&a?.type==='industry'&&a.operation==='fish')return 'fish';
 if(working&&a?.type==='industry'&&a.operation==='hunt')return 'hunt';
 if(working&&a?.type==='industry'&&a.operation==='shoreRest')return 'shoreRest';
 if(working&&a?.type==='culture'&&['open','speak'].includes(a.operation)&&w.culture?.events.some(e=>e.id===a.eventId&&['planned','held'].includes(e.status)))return 'celebrate';
 if(w.health?.cases.some(c=>c.personId===r.id&&c.stage!=='resolved'&&c.severity>=(c.rules?.severeSeverity??50)))return 'ill';
 if(working&&a&&(['gather','plant','water','harvest','cook'].includes(a.type)||a.type==='employment'&&a.operation==='work'||a.type==='construction'&&a.operation==='work'||a.type==='buildingMigration'&&a.operation==='work'||a.type==='ferry'&&['build','repair'].includes(a.operation)||a.type==='industry'&&['craft','mine','deepen','tendTree','feedAnimal','waterAnimal','tameAnimal','install','uninstall','tendHouse','repairTool','upgrade'].includes(a.operation)))return 'work';
 return 'idle';
}
