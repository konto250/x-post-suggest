import { readConfig } from '../server/config.js';
const {apiKey}=await readConfig();
for(const [model,effort,inputPrice,outputPrice] of [['gpt-5-nano','minimal',0.05,0.4],['gpt-6-luna','none',0.1,0.5]]) {
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,reasoning:{effort},max_output_tokens:1200,instructions:'日本語のX返信案を3つ作る。各案は80文字以内。体験を創作しない。JSON以外は出力しない。',input:'架空の動作確認用ポスト：今日は散歩して気分転換できました。#日常',text:{format:{type:'json_schema',name:'replies',strict:true,schema:{type:'object',properties:{suggestions:{type:'array',items:{type:'string'}}},required:['suggestions'],additionalProperties:false}}}})});
  if(!response.ok) {console.log(JSON.stringify({model,status:response.status}));continue;}
  const data=await response.json();const usage=data.usage || {};
  const text=(data.output||[]).flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
  let count;try{count=JSON.parse(text).suggestions.length;}catch{}
  console.log(JSON.stringify({model,status:data.status,count,inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,reasoningTokens:usage.output_tokens_details?.reasoning_tokens,estimatedUSD:(usage.input_tokens*inputPrice+usage.output_tokens*outputPrice)/1e6}));
}
