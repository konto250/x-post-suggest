import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../server/llm.js';
import { loadState, defaults } from '../src/core.js';
test('長い投稿・リンク先・履歴の送信量をサーバーで制限する',async()=>{
  let request;
  const result=await analyze({post:{url:'https://x.com/test_user/status/1',text:'本'.repeat(10000),links:['https://example.com']},settings:{context:20,instruction:'希'.repeat(2000)},context:Array.from({length:20},()=>({post:'過'.repeat(6000),reply:'返'.repeat(2000)}))},'dummy',async(_url,options)=>{
    request=JSON.parse(options.body);
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({summary:'要約',caution:'',suggestions:Array.from({length:3},()=>({label:'案',text:'返信'}))})}]}],usage:{input_tokens:100,output_tokens:80}})};
  },async url=>({url,title:'題',text:'文'.repeat(12000),status:'fetched'}));
  const input=JSON.parse(request.input);
  assert.equal(input.post.text.length,3500);assert.equal(input.links[0].text.length,1000);assert.equal(input.context.length,3);assert.equal(input.context[0].post.length,400);assert.equal(input.context[0].reply.length,240);
  assert.equal(request.max_output_tokens,1200);assert.equal(request.reasoning.effort,'none');assert.ok(request.instructions.length<1000);assert.match(result.inputNotice,/3500/);assert.equal(result.links[0].text.length,1000);assert.equal(result.usage.inputTokens,100);
});
test('参照件数を減らしても保存済みの元投稿・返信履歴を削除しない',()=>{
  const records=Array.from({length:10},(_,i)=>({id:String(i+1),post:{url:`https://x.com/test_user/status/${i+1}`,text:'元投稿'},reply:'返信',status:'sent',updatedAt:new Date().toISOString()}));
  const state=loadState({getItem:()=>JSON.stringify({version:1,settings:{...defaults,context:10},records})});
  assert.equal(state.settings.context,3);assert.equal(state.records.length,10);
});
