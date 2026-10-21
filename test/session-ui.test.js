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
function loginPage(pathname, authenticated) {
  const handlers={},requests=[],navigations=[];
  const elements={'login-form':{addEventListener:(name,fn)=>handlers[name]=fn,hidden:true,querySelector:()=>({disabled:false})},message:{},password:{value:'',focus(){}}};
  const location={pathname,search:'?from=x',hash:'#import=%7Bpayload%7D',replace:url=>{
    const target=new URL(url,'https://app.example');
    navigations.push({url,loadsDocument:target.pathname!==location.pathname || target.search!==location.search || !target.hash});
  }};
  const context=vm.createContext({document:{getElementById:id=>elements[id]},window:{addEventListener(){}},location,
    history:{replaceState:(_state,_title,url)=>{const target=new URL(url,'https://app.example');location.pathname=target.pathname;location.search=target.search;location.hash=target.hash;}},
    fetch:async(url,options)=>{requests.push({url,options});return {ok:url.endsWith('/login')||authenticated,status:authenticated?200:401,json:async()=>({authenticated:true})};}});
  vm.runInContext(loginSource,context);
  return {elements,handlers,requests,navigations};
}
test('外部遷移後は同一フラグメント内移動を避け、再入力なしでアプリを読み込む',async()=>{
  for(const pathname of ['/','/login']) {
    const page=loginPage(pathname,true);await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(page.navigations,[{url:'/?from=x#import=%7Bpayload%7D',loadsDocument:true}]);
    assert.equal(page.elements['login-form'].hidden,true);
    assert.deepEqual(page.requests.map(r=>r.url),['/api/auth/session']);
    assert.equal(page.requests[0].options.credentials,'same-origin');
  }
});
test('未ログインからパスワード認証した場合も本文とクエリーを保ってアプリを読み込む',async()=>{
  const page=loginPage('/',false);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(page.elements['login-form'].hidden,false);assert.equal(page.navigations.length,0);
  page.elements.password.value='テスト専用パスワード';
  await page.handlers.submit({preventDefault(){}});
  assert.deepEqual(page.navigations,[{url:'/?from=x#import=%7Bpayload%7D',loadsDocument:true}]);
  assert.equal(page.elements.password.value,'');
});
