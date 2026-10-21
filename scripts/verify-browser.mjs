import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { createHandler } from '../server/handler.js';

// Playwrightは検証環境のものを指定し、アプリの依存には追加しない。
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const production=process.argv.includes('--production');
const baseline=process.argv.includes('--baseline');
if(production && baseline)throw new Error('修正前の再現はローカル環境のみで実行してください。');
const config={accessToken:'test-only-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',apiKey:'test-only',model:'test',production:false,port:0};
const servers=[];
async function listen(server,host) {server.listen(0,host);await once(server,'listening');servers.push(server);return server.address().port;}
let browser;
try {
  let origin,password=config.accessToken;
  if(production) {
    origin='https://x-post-suggest.vercel.app';
    password=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8')).APP_ACCESS_TOKEN;
  } else {
    config.port=await listen(http.createServer(createHandler({configReader:async()=>config})),'127.0.0.1');
    origin=`http://127.0.0.1:${config.port}`;
  }
  const post={url:'https://x.com/test_user/status/123',text:'取り込み確認用の架空ポスト 😊 #確認',links:['https://example.com/article']};
  const target=origin+'/?from=bookmarklet#import='+encodeURIComponent(JSON.stringify(post));
  const externalPort=await listen(http.createServer((_req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<button id="open">外部サイトから取り込む</button><script>document.getElementById('open').onclick=()=>window.open(${JSON.stringify(target)},'_blank','noopener');</script>`);
  }),'localhost');
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({acceptDownloads:true});
  if(baseline) {
    const source=(await readFile(new URL('../auth/login.js',import.meta.url),'utf8')).replaceAll('openApp();','location.replace(destination());');
    await context.route('**/auth/login.js',route=>route.fulfill({contentType:'text/javascript',body:source}));
  }
  const page=await context.newPage();
  await page.goto(origin);
  await page.locator('#password').fill(password);
  await page.locator('#login-form button').click();
  await page.locator('#post-form').waitFor({state:'visible'});
  let loginPosts=0,initialLoginPage=false;
  context.on('request',request=>{if(request.url().endsWith('/api/auth/login')&&request.method()==='POST')loginPosts++;});
  const responses=[];
  context.on('response',response=>{
    if(response.request().isNavigationRequest()&&response.url().startsWith(origin+'/?from=bookmarklet'))responses.push(response.text().then(html=>{if(html.includes('login-form'))initialLoginPage=true;}).catch(()=>{}));
  });
  await page.goto(`http://localhost:${externalPort}`);
  const nextPage=context.waitForEvent('page');
  await page.locator('#open').click();
  const imported=await nextPage;
  if(baseline) {
    await assert.rejects(imported.locator('#post-form').waitFor({state:'visible',timeout:3000}));
    assert.match(await imported.locator('#message').textContent(),/ログイン状態を確認/);
    console.log('実ブラウザーで修正前の停止を再現しました。');
  } else {
    await imported.locator('#post-form').waitFor({state:'visible'});
    // HTML表示後のセッション確認と取り込み処理の完了を待つ。
    await imported.waitForFunction(expected=>document.getElementById('post-text')?.value===expected,post.text);
    assert.equal(await imported.locator('#post-text').inputValue(),post.text);
    assert.equal(await imported.locator('#post-url').inputValue(),post.url);
    assert.equal(await imported.locator('#post-links').inputValue(),post.links[0]);
    assert.equal(loginPosts,0,'再ログインを要求しない');
    await imported.locator('#reply').fill('検証用の下書きです。');
    await imported.locator('#save-draft').click();
    await imported.getByText('下書きを保存しました。',{exact:true}).waitFor();
    await imported.locator('[data-view="settings"]').click();
    const downloadPromise=imported.waitForEvent('download');
    await imported.locator('#export-settings').click();
    const download=await downloadPromise;
    assert.match(download.suggestedFilename(),/^x-replies-\d{4}-\d{2}-\d{2}\.json$/);
    const backup=JSON.parse(await readFile(await download.path(),'utf8'));
    assert.equal(backup.records.length,1);assert.equal(backup.records[0].post.text,post.text);
    assert.match(await imported.locator('#notice').textContent(),/ダウンロード.*フォルダー/);
    await mkdir('.test-artifacts',{recursive:true});
    await imported.screenshot({path:'.test-artifacts/backup-settings.png',fullPage:true});
    const other=await context.newPage();await other.goto(origin);await other.locator('#post-form').waitFor({state:'visible'});
    await imported.locator('#logout').click();
    await Promise.all([imported.locator('#login-form').waitFor({state:'visible'}),other.locator('#login-form').waitFor({state:'visible'})]);
    const stored=await imported.evaluate(()=>localStorage.getItem('x-post-suggest:v1'));
    assert.equal(JSON.parse(stored).records.length,1);
    console.log('実ブラウザー確認成功: 外部遷移後の再入力なし・本文/URL保持・JSONダウンロード・別タブログアウト・履歴保持');
  }
  await Promise.all(responses);
  assert.equal(initialLoginPage,true,'外部遷移の初回はStrict Cookieなしでログイン画面を受信');
} finally {
  await browser?.close();
  for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
