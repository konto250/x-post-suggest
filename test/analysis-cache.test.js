import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisKey, cachedAnalysis, writeCached, readCached, CACHE_KEY } from '../src/analysis-cache.js';
import { CACHE_TTL, CACHE_LIMIT } from '../src/analysis-config.js';
const result={suggestions:[{label:'共感',text:'案1'},{label:'質問',text:'案2'},{label:'短め',text:'案3'}],links:[]};
function storage(){const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};}
test('同じ入力は生成を再利用し、明示的な再生成だけAPIを呼び直す',async()=>{
  const local=storage();let calls=0;
  const options={storage:local,key:'same',generate:async()=>{calls++;return result;}};
  assert.equal((await cachedAnalysis(options)).reused,false);
  assert.equal((await cachedAnalysis(options)).reused,true);assert.equal(calls,1);
  assert.equal((await cachedAnalysis({...options,force:true})).reused,false);assert.equal(calls,2);
});
test('本文・文体・指示・履歴・モデル・仕様変更は別の結果として扱う',async()=>{
  const config={model:'gpt-6-luna',analysisVersion:'economy-v1'};
  const input={post:{text:'原文'},settings:{tone:'丁寧',instruction:'短く'},context:[]};
  const key=await analysisKey(input,config);
  for(const changed of [{...input,post:{text:'別の原文'}},{...input,settings:{...input.settings,tone:'カジュアル'}},{...input,settings:{...input.settings,instruction:'質問する'}},{...input,context:[{reply:'前の返信'}]}])assert.notEqual(await analysisKey(changed,config),key);
  assert.notEqual(await analysisKey(input,{...config,model:'gpt-5-mini'}),key);
  assert.notEqual(await analysisKey(input,{...config,analysisVersion:'next'}),key);
  assert.equal(await analysisKey(input,config),key);
});
test('24時間後は生成し直し、保存は最新50件まで',async()=>{
  const local=storage();writeCached(local,'old',result,1000);
  assert.ok(readCached(local,'old',1000+CACHE_TTL-1));assert.equal(readCached(local,'old',1000+CACHE_TTL),null);
  for(let i=0;i<CACHE_LIMIT+2;i++)writeCached(local,String(i),result,2000+i);
  assert.equal(JSON.parse(local.getItem(CACHE_KEY)).length,CACHE_LIMIT);assert.equal(readCached(local,'0',2100),null);
});
test('失敗結果は保存せず、キャッシュの破損や容量不足でも生成結果を返す',async()=>{
  const local=storage();await assert.rejects(cachedAnalysis({storage:local,key:'bad',generate:async()=>{throw new Error('失敗');}}));assert.equal(local.getItem(CACHE_KEY),null);
  local.setItem(CACHE_KEY,'壊れたJSON');assert.equal(readCached(local,'bad'),null);
  const full={getItem:()=>null,setItem:()=>{throw new Error('容量不足');}};
  const response=await cachedAnalysis({storage:full,key:'new',generate:async()=>result});assert.equal(response.saved,false);assert.equal(response.data,result);
});
