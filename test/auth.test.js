import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { issueSession, verifySession, sessionCookie, SESSION_SECONDS, createLoginLimiter } from '../server/auth.js';
import { createHandler } from '../server/handler.js';
const secret='test-only-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const laterSecret='rotated-only-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

async function setup(t, overrides={}) {
  let now=Date.now();
  const config={accessToken:secret,apiKey:'dummy-server-key',model:'test-model',port:0,production:false,origins:[],...overrides};
  let calls=0;
  const server=http.createServer(createHandler({configReader:async()=>config,clock:()=>now,generate:async(_input,key)=>{assert.equal(key,'dummy-server-key');calls++;return {suggestions:[{text:'テスト'}]};}}));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  config.port=server.address().port;
  const origin=`http://127.0.0.1:${config.port}`;
  const req=(url,options={})=>fetch(origin+url,options);
  const post=(url,body={},headers={})=>req(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const login=async()=>{const response=await post('/api/auth/login',{password:secret});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  return {req,post,login,config,origin,advance:ms=>now+=ms,calls:()=>calls};
}
function assertPrivate(response) {
  assert.match(response.headers.get('cache-control'),/private.*no-store/);
  assert.equal(response.headers.get('cdn-cache-control'),'no-store');
  assert.equal(response.headers.get('vercel-cdn-cache-control'),'no-store');
  assert.match(response.headers.get('vary'),/Cookie/);
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
}
test('未認証にはログイン画面のみを返し、全API・アプリ資材を拒否する',async t=>{
  const app=await setup(t);
  const response=await app.req('/');assert.equal(response.status,200);assertPrivate(response);
  const html=await response.text();assert.match(html,/login-form/);assert.doesNotMatch(html,/post-form|src\/main/);
  for(const path of ['/api/config','/api/analyze','/src/main.js','/src/core.js','/index.html','/server/config.js','/.env.local','/api/handler']) {
    const response=await app.req(path);assert.equal(response.status,401,path);assertPrivate(response);
  }
  assert.equal((await app.post('/api/analyze',{}, {'X-OpenAI-Key':'browser-key'})).status,401);
  assert.equal(app.calls(),0);
});
test('誤パスワードと不正Origin・不正Hostを拒否する',async t=>{
  const app=await setup(t);
  assert.equal((await app.post('/api/auth/login',{password:'wrong'})).status,401);
  for(const origin of ['https://evil.example','null','']) {
    assert.equal((await app.post('/api/auth/login',{password:secret},{Origin:origin})).status,403);
    assert.equal((await app.post('/api/auth/logout',{}, {Origin:origin})).status,403);
  }
  assert.equal((await app.post('/api/auth/login',{password:secret},{'Sec-Fetch-Site':'cross-site'})).status,403);
  const status=await new Promise((resolve,reject)=>{http.get(app.origin,{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});
  assert.equal(status,403);
});
test('認証後の画面とAPI、未認証へのキャッシュ分離、ログアウト',async t=>{
  const app=await setup(t);const cookie=await app.login();
  const page=await app.req('/',{headers:{Cookie:cookie}});assertPrivate(page);assert.match(await page.text(),/post-form/);
  const config=await app.req('/api/config',{headers:{Cookie:cookie}});assert.equal(config.status,200);assertPrivate(config);assert.deepEqual(await config.json(),{hasKey:true,model:'test-model',analysisVersion:'economy-v2-roles'});
  assert.equal((await app.post('/api/analyze',{}, {Cookie:cookie,'X-OpenAI-Key':'ignored-browser-key'})).status,200);
  assert.equal((await app.post('/api/analyze',{}, {Cookie:cookie,Origin:'https://evil.example'})).status,403);
  const anonymous=await app.req('/');assertPrivate(anonymous);assert.doesNotMatch(await anonymous.text(),/post-form/);
  assert.equal((await app.req('/api/config')).status,401);
  const logout=await app.post('/api/auth/logout',{}, {Cookie:cookie});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);assertPrivate(logout);
  assert.equal((await app.req('/api/auth/session')).status,401);
});
test('Cookieの改ざん・期限切れ・パスワード変更を拒否する',async t=>{
  const app=await setup(t);const cookie=await app.login();
  assert.equal((await app.req('/api/config',{headers:{Cookie:cookie+'x'}})).status,401);
  app.advance(SESSION_SECONDS*1000+1000);
  assert.equal((await app.req('/api/config',{headers:{Cookie:cookie}})).status,401);
  const fresh=await app.login();app.config.accessToken=laterSecret;
  assert.equal((await app.req('/api/config',{headers:{Cookie:fresh}})).status,401);
});
test('認証設定がない・短い・単純な場合はフェイルクローズ',async t=>{
  const app=await setup(t);
  for(const token of ['', 'short', 'a'.repeat(64)]) {
    app.config.accessToken=token;
    for(const path of ['/','/api/config','/api/auth/session'])assert.equal((await app.req(path)).status,503);
    assert.equal((await app.post('/api/auth/login',{password:token})).status,503);
  }
});
test('ログイン試行はIPごと5回/15分で制限し、時間後に回復する',async t=>{
  const app=await setup(t);
  for(let i=0;i<5;i++)assert.equal((await app.post('/api/auth/login',{password:'wrong'})).status,401);
  const limited=await app.post('/api/auth/login',{password:secret});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
  let now=0;const limiter=createLoginLimiter({now:()=>now});for(let i=0;i<5;i++)assert.equal(limiter('ip').allowed,true);assert.equal(limiter('ip').allowed,false);now=900001;assert.equal(limiter('ip').allowed,true);
});
test('本番Cookieに必須属性を付け、Domainを指定せず、30日だけ検証する',()=>{
  const now=Date.now(),token=issueSession(secret,now),cookie=sessionCookie(token,true);
  for(const pattern of [/^__Host-xps_session=/,/HttpOnly/,/Secure/,/SameSite=Strict/,/Path=\//,/Max-Age=2592000/])assert.match(cookie,pattern);
  assert.doesNotMatch(cookie,/Domain=/i);assert.ok(verifySession(token,secret,now));assert.equal(verifySession(token,secret,now+SESSION_SECONDS*1000),false);assert.equal(verifySession(token,laterSecret,now),false);
  const parts=token.split('.');parts[2]=String(Number(parts[2])+100);assert.equal(verifySession(parts.join('.'),secret,now),false);
});
