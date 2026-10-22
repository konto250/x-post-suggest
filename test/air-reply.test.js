import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../server/llm.js';

test('両方の生成モードへ通常返信とエアリプの区別を保って文脈を渡す',async()=>{
  const requests=[];
  const input={post:{url:'https://x.com/test_user/status/1',text:'効率化のための会議がまた増えました。',links:['https://example.com']},context:[{post:'過去投稿',reply:'過去返信'},{kind:'air-reply',post:'別の過去投稿',reply:'前回のエアリプ'}]};
  const fetcher=async(_url,options)=>{
    requests.push(JSON.parse(options.body));
    return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({summary:'会議について',caution:'',suggestions:[{label:'皮肉',text:'効率化の会議で一日が埋まる。順調ですね。'},{label:'短め',text:'会議を減らす会議、まず増やします。'},{label:'冷笑',text:'効率化って予定表を埋めることだったんですね。'}]})}]}]})};
  };
  const inspect=async url=>({url,status:'fetched',text:'会議削減の方針',note:''});
  const air=await analyze({...input,mode:'air-reply'},'test-only',fetcher,inspect);
  assert.equal(air.mode,'air-reply');assert.equal(air.contextCount,2);assert.equal(air.suggestions.length,3);
  const airInput=JSON.parse(requests[0].input);
  assert.equal(airInput.post.text,input.post.text);assert.equal(airInput.links[0].text,'会議削減の方針');assert.deepEqual(airInput.context.map(c=>c.kind),['reply','air-reply']);assert.equal(airInput.context[1].reply,'前回のエアリプ');
  assert.equal(requests[0].max_output_tokens,1200);assert.equal(requests[0].store,false);
  const normal=await analyze(input,'test-only',fetcher,inspect);
  assert.equal(normal.mode,'reply');assert.equal(normal.contextCount,2);assert.equal(JSON.parse(requests[1].input).context[0].reply,'過去返信');assert.equal(JSON.parse(requests[1].input).context[1].kind,'air-reply');
  assert.notEqual(requests[0].instructions,requests[1].instructions);
});
