import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, normalizePost, prune, contextFor, loadState, saveState } from '../src/core.js';
import { isPublicIPv4, inspectLink } from '../server/links.js';
import { analyze } from '../server/llm.js';
const post = (user='alice',id='1') => normalizePost({url:`https://x.com/${user}/status/${id}`,text:'テスト #話題 https://example.com'});
const record = (id,user,status='sent') => ({id,post:post(user,id),status,reply:`返信${id}`,updatedAt:`2026-10-${String(Number(id)+1).padStart(2,'0')}T00:00:00.000Z`});
test('URLから相手を正規化し、リンクと日本語タグを抽出する',() => {
  const p = post('ALICE'); assert.equal(p.author,'alice'); assert.deepEqual(p.hashtags,['#話題']);assert.deepEqual(p.links,['https://example.com/']);
  assert.throws(() => normalizePost({url:'https://x.com.evil.test/a/status/1',text:'本文'}));
  assert.throws(() => normalizePost({url:'javascript:alert(1)',text:'本文'}));
});
test('相手ごとと全体の上限を新しい順で適用する',() => {
  const records = [record('1','a'),record('2','a'),record('3','b'),record('4','a')];
  assert.deepEqual(prune(records,{perUser:1,total:2}).map(r => r.id),['4','3']);
  assert.deepEqual(prune(records,{perUser:3,total:1}).map(r => r.id),['4']);
});
test('文脈には同じ相手の投稿済み返信のみを使用し、現在のポストは除く',() => {
  const records = [record('1','alice'),record('2','bob'),record('3','alice','draft'),record('4','alice'),record('5','alice')];
  assert.deepEqual(contextFor(records,post('alice','5'),{context:1}).map(c => c.reply),['返信4']);
});
test('保存と復元で本文・返信を保持する',() => {
  let value; const storage={setItem:(_k,v) => value=v,getItem:() => value};
  saveState(storage,{settings:defaults,records:[record('1','alice')]});
  assert.equal(loadState(storage).records[0].reply,'返信1'); assert.equal(JSON.parse(value).version,1);
  assert.throws(() => loadState({getItem:() => '{broken'}));
  assert.throws(() => saveState({setItem:() => {throw new Error('容量不足');}},{settings:defaults,records:[]}));
});
test('ローカル・予約済みIPをリンク取得から除外する',async () => {
  for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','224.0.0.1']) assert.equal(isPublicIPv4(ip),false,ip);
  assert.equal(isPublicIPv4('93.184.216.34'),true);
  assert.equal((await inspectLink('http://127.0.0.1/private')).status,'unavailable');
});
test('生成要求にリンク本文と文脈を渡し、API保存を無効にする',async () => {
  let payload;
  const result = await analyze({post:post(),settings:defaults,context:[{post:'過去の原文',reply:'過去の返信'}]},'test-key',async (_url,options) => {
    payload=JSON.parse(options.body);
    return {ok:true,json:async () => ({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'要約',caution:'',suggestions:[{label:'共感',text:'案1'},{label:'質問',text:'案2'},{label:'短め',text:'案3'}]})}]}]})};
  },async url => ({url,status:'fetched',text:'取得した本文',note:'テスト'}));
  assert.equal(payload.store,false);assert.equal(payload.text.format.type,'json_schema');
  const input=JSON.parse(payload.input);assert.equal(input.context[0].reply,'過去の返信');assert.equal(input.links[0].text,'取得した本文');assert.equal(result.suggestions.length,3);
});
test('APIの認証エラーと不正応答を成功として扱わない',async () => {
  const input={post:normalizePost({url:'https://x.com/a/status/1',text:'本文'})};
  await assert.rejects(analyze(input,'key',async () => ({ok:false,status:401})),/APIキー/);
  await assert.rejects(analyze(input,'key',async () => ({ok:true,json:async () => ({output:[]})})),/読み取れません/);
});
