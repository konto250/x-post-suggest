import assert from 'node:assert/strict';
import { analyze } from '../server/llm.js';
import { readConfig } from '../server/config.js';

// 実APIを1回使用する。秘密情報は出力しない。
const config=await readConfig();
const withHistory=process.argv.includes('--with-history');
const input={
  post:{url:'https://x.com/greeting_test/status/123',text:'こんとさんおはようございます！\n今日もHappyな一日をお過ごしくださいませ✨'},
  settings:{ownHandle:withHistory?'konto_test':''},
  context:withHistory?[{post:'こんとさん、おはようございます！',reply:'おはようございます！こんとさんも良い一日を✨'}]:[]
};
let result;
if(process.argv.includes('--production')) {
  const origin='https://x-post-suggest.vercel.app';
  const post=(path,body,cookie)=>fetch(origin+path,{method:'POST',redirect:'error',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  const login=await post('/api/auth/login',{password:config.accessToken});
  assert.equal(login.status,200,'公開環境のログイン');
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  try {
    const response=await post('/api/analyze',input,cookie);assert.equal(response.status,200,'返信生成');result=await response.json();
  } finally {const logout=await post('/api/auth/logout',{},cookie);assert.equal(logout.status,200,'検証セッションの終了');}
} else result=await analyze(input,config.apiKey,undefined,undefined,config.model);
assert.equal(result.suggestions.length,3);
for(const suggestion of result.suggestions) {
  assert.doesNotMatch(suggestion.text,/こんと|konto_test/,'本人の呼び名を返信相手に使わない');
  assert.match(suggestion.text,/おはよう|ありがとう/,'挨拶や気遣いに応答する');
}
console.log(JSON.stringify({検証:'呼びかけ先と返信相手の区別',履歴あり:withHistory,モデル:result.model,返信案:result.suggestions,使用量:result.usage},null,2));
