export const QWEN_MODEL='qwen3.8-flash';
export const DEEPSEEK_MODEL='deepseek-ai/DeepSeek-R1-0528-Qwen3-8B';
export const GLM_MODEL='THUDM/GLM-Z1-9B-0414';
export type ModelName=typeof QWEN_MODEL|typeof DEEPSEEK_MODEL|typeof GLM_MODEL;
export type ModelConnection={model:ModelName;key:string};
export type ModelMessage={role:'system'|'user';content:string};
type Usage={prompt_tokens?:number;completion_tokens?:number};
export type ModelReply={content:string;finish:string|null;usage?:Usage};
type Reply=ModelReply;
type Chunk={choices?:Array<{delta?:{content?:string};finish_reason?:string|null}>;usage?:Usage;error?:unknown};

// Reserve headroom for the provider template and keep some of the account quota free.
// DeepSeek's per-minute budget is smaller than its context window.
export const modelLimits={
 [QWEN_MODEL]:{inputBytes:980_000,tpm:4_500_000,rpm:null,answerTokens:768,thinkingTokens:512,startSlots:8,maxSlots:16},
 [DEEPSEEK_MODEL]:{inputBytes:40_000,tpm:45_000,rpm:900,answerTokens:512,thinkingTokens:1536,startSlots:4,maxSlots:8},
 [GLM_MODEL]:{inputBytes:120_000,tpm:null,rpm:null,answerTokens:400,thinkingTokens:2048,startSlots:2,maxSlots:4},
} as const;

export function checkedInputBytes(model:ModelName,messages:ModelMessage[]):number{
 const bytes=Buffer.byteLength(JSON.stringify(messages),'utf8');
 if(bytes>modelLimits[model].inputBytes)throw new Error('model_context_limit');
 return bytes;
}

/** Pure request encoding shared by production and offline HTTP rehearsals.
 * This function neither reads credentials nor performs transport. */
export function modelRequestPayload(model:ModelName,messages:ModelMessage[],temperature:number){
 // Snapshot once so a toJSON/accessor cannot change the body after byte checking.
 const encoded=JSON.stringify(messages);
 if(Buffer.byteLength(encoded,'utf8')>modelLimits[model].inputBytes)throw new Error('model_context_limit');
 messages=JSON.parse(encoded) as ModelMessage[];
 const {answerTokens,thinkingTokens}=modelLimits[model];
 const qwen=model===QWEN_MODEL,deepseek=model===DEEPSEEK_MODEL;
 const options=qwen?{stream:true,stream_options:{include_usage:true},enable_thinking:true,thinking_budget:thinkingTokens}
  :{stream:false,enable_thinking:deepseek,thinking_budget:deepseek||temperature===0.6?thinkingTokens:1536};
 return JSON.stringify({model,messages,temperature,max_tokens:answerTokens,...options});
}
export const SILICONFLOW_COMPLETIONS_ENDPOINT='https://api.siliconflow.cn/v1/chat/completions';

async function readCompletionStream(response:Response):Promise<Reply>{
 const reply:Reply={content:'',finish:null};
 const reader=response.body?.pipeThrough(new TextDecoderStream()).getReader();
 if(!reader)return reply;
 let pending='';
 try{
  for(;;){
   const {value,done}=await reader.read();
   if(done)return reply;
   pending+=value;
   let boundary:RegExpExecArray|null;
   while((boundary=/\r?\n\r?\n/.exec(pending))){
    const event=pending.slice(0,boundary.index);
    pending=pending.slice(boundary.index+boundary[0].length);
    const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data)continue;
    if(data.trim()==='[DONE]')return reply;
    const chunk=JSON.parse(data) as Chunk;
    if(chunk.error)throw new Error('model_stream_error');
    if(chunk.usage)reply.usage=chunk.usage;
    const choice=chunk.choices?.[0];
    if(choice?.finish_reason)reply.finish=choice.finish_reason;
    if(typeof choice?.delta?.content==='string')reply.content+=choice.delta.content;
   }
   if(pending.length>1_000_000||reply.content.length>32_000)throw new Error('model_stream_error');
  }
 }finally{
  await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}

export async function completeModel(key:string,model:ModelName,messages:ModelMessage[],temperature:number,signal?:AbortSignal):Promise<Reply>{
 const body=modelRequestPayload(model,messages,temperature),qwen=model===QWEN_MODEL;
 const endpoint=qwen?'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1/chat/completions':SILICONFLOW_COMPLETIONS_ENDPOINT;
 const response=await fetch(endpoint,{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
  body,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(qwen?25_000:150_000)]):AbortSignal.timeout(qwen?25_000:150_000)
 });
 if(!response.ok)throw new Error(`model_http_${response.status}`);
 if(qwen)return readCompletionStream(response);
 const data=await response.json() as {choices?:Array<{message?:{content?:string};finish_reason?:string}>;usage?:Usage};
 const choice=data.choices?.[0];
 return {content:typeof choice?.message?.content==='string'?choice.message.content:'',finish:choice?.finish_reason??null,usage:data.usage};
}
