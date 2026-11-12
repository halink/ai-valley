import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSelfHostedConfig} from '../src/server/self-hosted-config.js';
import {DEEPSEEK_MODEL,GLM_MODEL,QWEN_MODEL} from '../src/server/model-completion.js';
const base={VALLEY_SELF_HOSTED:'enabled',VALLEY_PRIMARY_PROVIDER:'siliconflow',VALLEY_PRIMARY_MODEL:DEEPSEEK_MODEL,SILICONFLOW_API_KEY:'fake-only'};
test('self-hosted requires explicit opt-in and never infers backup',()=>{
 assert.deepEqual(readSelfHostedConfig({SILICONFLOW_API_KEY:'fake'}),[]);
 assert.deepEqual(readSelfHostedConfig({...base,DASHSCOPE_API_KEY:'fake-qwen'}),[{model:DEEPSEEK_MODEL,key:'fake-only'}]);
 assert.deepEqual(readSelfHostedConfig({...base,VALLEY_BACKUP_PROVIDER:'siliconflow',VALLEY_BACKUP_MODEL:GLM_MODEL}).map(p=>p.model),[DEEPSEEK_MODEL,GLM_MODEL]);
});
test('invalid, duplicate, missing and paid configurations fail without exposing values',()=>{
 for(const extra of [{VALLEY_PRIMARY_PROVIDER:'siliconflow',VALLEY_PRIMARY_MODEL:'secret-string'},{SILICONFLOW_API_KEY:''},{VALLEY_BACKUP_PROVIDER:'siliconflow',VALLEY_BACKUP_MODEL:DEEPSEEK_MODEL},{VALLEY_BACKUP_PROVIDER:'dashscope',VALLEY_BACKUP_MODEL:QWEN_MODEL,DASHSCOPE_API_KEY:'fake'}])assert.throws(()=>readSelfHostedConfig({...base,...extra}),/^Error: self_hosted_/);
 assert.equal(readSelfHostedConfig({...base,VALLEY_BACKUP_PROVIDER:'dashscope',VALLEY_BACKUP_MODEL:QWEN_MODEL,DASHSCOPE_API_KEY:'fake',VALLEY_ALLOW_PAID_MODELS:'yes'})[1].model,QWEN_MODEL);
});
test('provider declarations are mandatory, paired, and never inferred from models or keys',()=>{
 for(const extra of [
  {VALLEY_PRIMARY_PROVIDER:undefined},
  {VALLEY_PRIMARY_PROVIDER:'dashscope'},
  {VALLEY_PRIMARY_PROVIDER:'unsupported-private-value'},
  {VALLEY_BACKUP_MODEL:GLM_MODEL},
  {VALLEY_BACKUP_PROVIDER:'siliconflow'},
  {VALLEY_BACKUP_PROVIDER:'dashscope',VALLEY_BACKUP_MODEL:GLM_MODEL},
  {VALLEY_BACKUP_PROVIDER:'siliconflow',VALLEY_BACKUP_MODEL:QWEN_MODEL,VALLEY_ALLOW_PAID_MODELS:'yes'},
 ])assert.throws(()=>readSelfHostedConfig({...base,...extra,DASHSCOPE_API_KEY:'fake-other'}),/^Error: self_hosted_/);
 const config=readSelfHostedConfig({...base,VALLEY_PRIMARY_PROVIDER:'dashscope',VALLEY_PRIMARY_MODEL:QWEN_MODEL,DASHSCOPE_API_KEY:'fake-dash',VALLEY_ALLOW_PAID_MODELS:'yes',VALLEY_BACKUP_PROVIDER:'siliconflow',VALLEY_BACKUP_MODEL:GLM_MODEL});
 assert.deepEqual(config,[{model:QWEN_MODEL,key:'fake-dash'},{model:GLM_MODEL,key:'fake-only'}]);
 assert.throws(()=>readSelfHostedConfig({...base,SILICONFLOW_API_KEY:'',DASHSCOPE_API_KEY:'fake-other'}),/self_hosted_missing_key/);
});
