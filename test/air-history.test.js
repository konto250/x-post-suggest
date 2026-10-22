import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, normalizePost, recordId, saveState, loadState, contextFor } from '../src/core.js';
const post=normalizePost({url:'https://x.com/test_user/status/1',text:'元投稿'});
const record=(kind,status='sent')=>({id:recordId(post,kind),kind,post,reply:kind==='air-reply'?'エアリプの内容':'返信の内容',status,updatedAt:'2026-10-22T10:00:00.000Z'});

test('古い返信履歴と同じポストのエアリプを保存・復元しても混同しない',()=>{
  let raw;const storage={setItem:(_k,v)=>raw=v,getItem:()=>raw};
  const legacy=record('reply');delete legacy.kind;
  saveState(storage,{settings:defaults,records:[legacy,record('air-reply')]});
  const loaded=loadState(storage);
  assert.equal(loaded.records.length,2);assert.deepEqual(loaded.records.map(r=>r.id),['1','air:1']);assert.deepEqual(loaded.records.map(r=>r.kind),['reply','air-reply']);
  const air=loaded.records.find(r=>r.kind==='air-reply');air.reply='編集済みエアリプ';saveState(storage,loaded);
  const restored=loadState({getItem:()=>JSON.stringify(JSON.parse(raw))});
  assert.equal(restored.records[0].reply,'返信の内容');assert.equal(restored.records[1].reply,'編集済みエアリプ');
});
test('投稿済みエアリプは別ポストの文脈になり、下書き・現在のポスト・別の相手を除外する',()=>{
  const next=normalizePost({url:'https://x.com/test_user/status/2',text:'次の投稿'});
  const other={...record('air-reply'),post:normalizePost({url:'https://x.com/other/status/3',text:'別の相手'})};
  const records=[record('reply'),record('air-reply'),{...record('air-reply','draft'),post:next},other];
  assert.deepEqual(contextFor(records,next,defaults).map(c=>c.kind),['reply','air-reply']);
  assert.equal(contextFor(records,post,defaults).length,0);
  assert.equal(contextFor(records,next,{...defaults,context:1}).length,1);
});
