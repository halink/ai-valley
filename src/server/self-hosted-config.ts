import {QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL,type ModelName,type ModelConnection} from './model-completion.js';
/** Configuration is not evidence of provider pricing or account eligibility. */
export function readSelfHostedConfig(env:Readonly<Record<string,string|undefined>>):readonly ModelConnection[]{
 if(!env.VALLEY_SELF_HOSTED||env.VALLEY_SELF_HOSTED==='disabled')return [];
 if(env.VALLEY_SELF_HOSTED!=='enabled')throw Error('self_hosted_invalid_mode');
 const primary=env.VALLEY_PRIMARY_MODEL,backup=env.VALLEY_BACKUP_MODEL;
 if(!primary)throw Error('self_hosted_primary_required');
 if(backup===primary)throw Error('self_hosted_duplicate_model');
 const primaryProvider=env.VALLEY_PRIMARY_PROVIDER,backupProvider=env.VALLEY_BACKUP_PROVIDER;
 if(!primaryProvider)throw Error('self_hosted_primary_provider_required');
 if(!backup&&backupProvider)throw Error('self_hosted_backup_model_required');
 if(backup&&!backupProvider)throw Error('self_hosted_backup_provider_required');
 return [{id:primary,provider:primaryProvider},...backup?[{id:backup,provider:backupProvider!}]:[]].map(({id,provider})=>{
  if(provider!=='siliconflow'&&provider!=='dashscope')throw Error('self_hosted_unsupported_provider');
  if(![QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL].includes(id as ModelName))throw Error('self_hosted_unsupported_model');
  const expected=id===QWEN_MODEL?'dashscope':'siliconflow';
  if(provider!==expected)throw Error('self_hosted_provider_model_mismatch');
  if(id===QWEN_MODEL&&env.VALLEY_ALLOW_PAID_MODELS!=='yes')throw Error('self_hosted_paid_model_not_enabled');
  const key=env[provider==='dashscope'?'DASHSCOPE_API_KEY':'SILICONFLOW_API_KEY']?.trim();
  if(!key)throw Error('self_hosted_missing_key');
  return Object.freeze({model:id as ModelName,key});
 });
}
