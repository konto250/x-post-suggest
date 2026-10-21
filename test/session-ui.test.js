import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=(await readFile(new URL('../src/session.js',import.meta.url),'utf8')).replaceAll('export ','');
const loginSource=await readFile(new URL('../auth/login.js',import.meta.url),'utf8');
test('ログアウトはCookie削除API後に画面を閉じ、別タブに通知し、履歴を保持する',async()=>{
  const events={},stored=new Map([['x-post-suggest:v1','保存済みの履歴']]);let navigated,closed=false,message,requested;
  const channel={postMessage:value=>message=value};
  const context=vm.createContext({BroadcastChannel:function(){return channel;},window:{addEventListener:(name,fn)=>events[name]=fn},document:{body:{replaceChildren:()=>closed=true},documentElement:{}},location:{search:'',hash:'#import=payload',replace:url=>navigated=url},localStorage:{setItem:(k,v)=>stored.set(k,v)},crypto:{randomUUID:()=> 'signal'},fetch:async(url,options)=>{requested={url,options};return {ok:true};}});
  vm.runInContext(source,context);await vm.runInContext('logout()',context);
  assert.equal(requested.url,'/api/auth/logout');assert.equal(requested.options.method,'POST');assert.equal(message,'logout');assert.equal(closed,true);assert.equal(navigated,'/login#import=payload');assert.equal(stored.get('x-post-suggest:v1'),'保存済みの履歴');
  assert.deepEqual([...stored.keys()],['x-post-suggest:v1','x-post-suggest:logout']);
});
test('別タブのログアウト通知と認証切れは画面を破棄する',async()=>{
  for(const trigger of ['broadcast','storage','unauthorized']) {
    const events={};let closed=false,navigated;const channel={};
    const context=vm.createContext({BroadcastChannel:function(){return channel;},window:{addEventListener:(name,fn)=>events[name]=fn},document:{body:{replaceChildren:()=>closed=true},documentElement:{}},location:{search:'',hash:'',replace:url=>navigated=url},fetch:async()=>({ok:false,status:401})});
    vm.runInContext(source,context);
    if(trigger==='broadcast')channel.onmessage({data:'logout'});
    if(trigger==='storage')events.storage({key:'x-post-suggest:logout'});
    if(trigger==='unauthorized')await vm.runInContext('checkSession()',context);
    assert.equal(closed,true);assert.equal(navigated,'/login');
  }
});
test('外部遷移後のセッション確認で再入力を避け、取り込みフラグメントを保持する',async()=>{
  const elements={'login-form':{addEventListener(){},hidden:true},message:{},password:{}};let navigated;
  const context=vm.createContext({document:{getElementById:id=>elements[id]},window:{addEventListener(){}},location:{search:'?from=x',hash:'#import=%7Bpayload%7D',replace:url=>navigated=url},fetch:async()=>({ok:true})});
  vm.runInContext(loginSource,context);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(navigated,'/?from=x#import=%7Bpayload%7D');assert.equal(elements['login-form'].hidden,true);
});
