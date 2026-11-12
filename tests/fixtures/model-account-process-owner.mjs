// Test-only disposable caller. The test kills THIS process, not its watchdog.
import {launchSyntheticAccountProcess} from '../../scripts/production-model-account-launch.mjs';
process.once('message',options=>{
 launchSyntheticAccountProcess(options,{scenario:'block',reportDescriptor:4,onMessage:message=>{if(process.connected)process.send(message,()=>{});}});
});
