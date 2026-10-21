import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { issueSession, SESSION_SECONDS } from '../server/auth.js';
import { analysisKey, cachedAnalysis } from '../src/analysis-cache.js';
const target=new URL(process.argv[2] || 'http://localhost:4317');
if(!['localhost','127.0.0.1'].includes(target.hostname) && !(target.protocol==='https:' && /^x-post-suggest(?:-[a-z0-9-]+)?\.vercel\.app$/.test(target.hostname))) throw new Error('このアプリの検証先URLのみ指定できます。');
const origin=target.origin;
const secret=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8')).APP_ACCESS_TOKEN;
const check=(ok,label)=>{if(!ok)throw new Error(`検証失敗: ${label}`);};
const request=(path,options={})=>fetch(origin+path,{redirect:'manual',...options});
const post=(path,body,headers={})=>request(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const privateResponse=response=>{
  check(/no-store/.test(response.headers.get('cache-control') || ''),'Cache-Control no-store');
  check(/Cookie/i.test(response.headers.get('vary') || ''),'Vary Cookie');
  check(!['HIT','STALE'].includes(response.headers.get('x-vercel-cache')),'CDNキャッシュ非配信');
};
const anonymous=await request('/');check(anonymous.status===200,'未認証ログイン画面');privateResponse(anonymous);
const loginHtml=await anonymous.text();check(loginHtml.includes('login-form')&&!loginHtml.includes('post-form'),'アプリHTMLの非公開');
for(const path of ['/api/config','/api/analyze','/src/main.js','/index.html','/server/config.js','/.env.local','/api/handler']) {const response=await request(path);check(response.status===401,`未認証 ${path}`);privateResponse(response);}
check((await post('/api/auth/login',{password:'invalid-password'})).status===401,'誤ったパスワード');
check((await post('/api/auth/login',{password:'invalid-password'},{Origin:'https://example.com'})).status===403,'ログインOrigin検証');
const login=await post('/api/auth/login',{password:secret});check(login.status===200,'正しいパスワード');privateResponse(login);
const setCookie=login.headers.get('set-cookie') || '';check(/HttpOnly/i.test(setCookie)&&/SameSite=Strict/i.test(setCookie)&&/Path=\//.test(setCookie)&&/Max-Age=2592000/.test(setCookie)&&!/Domain=/i.test(setCookie),'Cookie属性');
if(target.protocol==='https:')check(/Secure/i.test(setCookie)&&setCookie.startsWith('__Host-'),'本番Cookie');
const cookie=setCookie.split(';')[0],cookieName=cookie.split('=')[0];
try {
  const page=await request('/',{headers:{Cookie:cookie}});check(page.status===200,'認証済み画面');privateResponse(page);const html=await page.text();check(html.includes('post-form')&&!html.includes(secret),'アプリ画面・シークレット非露出');
  const config=await request('/api/config',{headers:{Cookie:cookie}});check(config.status===200,'認証済みAPI');privateResponse(config);const settings=await config.json();check(settings.hasKey===true,'サーバーAPIキー');
  check((await request('/api/config',{headers:{Cookie:cookie+'x'}})).status===401,'Cookie改ざん');
  const expired=`${cookieName}=${issueSession(secret,Date.now()-(SESSION_SECONDS+60)*1000)}`;
  check((await request('/api/config',{headers:{Cookie:expired}})).status===401,'期限切れCookie');
  check((await post('/api/auth/logout',{}, {Cookie:cookie,Origin:'https://example.com'})).status===403,'ログアウトOrigin検証');
  for(let i=0;i<3;i++) {const response=await request('/');privateResponse(response);check(!(await response.text()).includes('post-form'),'認証直後の匿名応答分離');check((await request('/api/config')).status===401,'匿名API分離');}
  if(process.argv.includes('--generate')) {
    const input={post:{url:'https://x.com/test_user/status/1',text:'動作確認用の架空ポストです。散歩で気分転換できました。'},context:[]};
    const local=new Map();const storage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)};let calls=0;
    const key=await analysisKey(input,settings);
    const generate=async()=>{calls++;const response=await post('/api/analyze',input,{Cookie:cookie});check(response.status===200,'公開環境での返信生成');return response.json();};
    const first=await cachedAnalysis({storage,key,generate});check(first.data.suggestions?.length===3,'返信案3件');check(first.data.model==='gpt-6-luna','節約モデル');check(first.data.usage?.outputTokens<=1200,'出力上限');
    const second=await cachedAnalysis({storage,key,generate});check(second.reused && calls===1,'再利用時のOpenAI API呼び出しなし');
    console.log('公開環境の実API生成: '+JSON.stringify({model:first.data.model,suggestions:first.data.suggestions.length,usage:first.data.usage,reused:second.reused,apiCalls:calls}));
  }
} finally {
  const response=await post('/api/auth/logout',{}, {Cookie:cookie});check(response.status===200 && /Max-Age=0/.test(response.headers.get('set-cookie') || ''),'ログアウトCookie削除');privateResponse(response);
}
check((await request('/api/auth/session')).status===401,'ログアウト後の未認証');
console.log('実通信確認成功: 未認証拒否・ログイン・署名/期限・Origin・キャッシュ分離・ログアウト');
