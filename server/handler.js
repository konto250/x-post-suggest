import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readConfig } from './config.js';
import { analyze } from './llm.js';
import { validAccessToken, matchPassword, issueSession, verifySession, sessionFromRequest, sessionCookie, requestOrigin, validMutationOrigin, createLoginLimiter } from './auth.js';
import { securityHeaders } from './headers.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const publicFiles = new Map([['/auth/login.js','auth/login.js'],['/auth/login.css','auth/login.css']]);
const protectedFiles = new Map([['/','index.html'],...['main.js','core.js','bookmarklet.js','session.js','style.css'].map(f=>['/src/'+f,'src/'+f])]);
async function readJson(req,limit) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('JSON形式で送信してください。'),{status:415});
  if (req.body !== undefined) {
    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(text)>limit) throw Object.assign(new Error('入力が大きすぎます。'),{status:413});
    try { return JSON.parse(text); } catch { throw Object.assign(new Error('入力形式が不正です。'),{status:400}); }
  }
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>limit) throw Object.assign(new Error('入力が大きすぎます。'),{status:413}); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('入力形式が不正です。'),{status:400}); }
}
export function createHandler({configReader=readConfig,generate=analyze,limiter=createLoginLimiter(),clock=Date.now}={}) {
  let generating=false;
  return async function handler(req,res) {
    securityHeaders(res);
    const json=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
    const file=async name=>{const data=await readFile(path.join(root,name));res.statusCode=200;res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(req.method==='HEAD'?undefined:data);};
    try {
      const config=await configReader(); securityHeaders(res,config.production);
      const origin=requestOrigin(req,config);
      if(!origin) return json(403,{error:'許可されていないホストです。'});
      const pathname=new URL(req.url,origin).pathname;
      const get=req.method==='GET'||req.method==='HEAD';
      if(get && publicFiles.has(pathname)) return await file(publicFiles.get(pathname));
      if(!validAccessToken(config.accessToken)) return json(503,{error:'認証設定が未設定または不正です。サーバーのAPP_ACCESS_TOKENを設定してください。'});
      const authenticated=verifySession(sessionFromRequest(req,config.production),config.accessToken,clock());
      if(pathname==='/api/auth/login' && req.method==='POST') {
        if(!validMutationOrigin(req,origin)) return json(403,{error:'このサイトのログイン画面から実行してください。'});
        const forwarded=String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        const ip=config.production ? (isIP(forwarded)?forwarded:'unknown') : req.socket?.remoteAddress || 'local';
        const attempt=limiter(ip);
        if(!attempt.allowed) {res.setHeader('Retry-After',attempt.retryAfter);return json(429,{error:'試行回数の上限です。15分ほど待ってから再実行してください。'});}
        const data=await readJson(req,2048);
        if(!matchPassword(data?.password,config.accessToken)) return json(401,{error:'パスワードが正しくありません。'});
        res.setHeader('Set-Cookie',sessionCookie(issueSession(config.accessToken,clock()),config.production));
        return json(200,{authenticated:true});
      }
      if(pathname==='/api/auth/logout' && req.method==='POST') {
        if(!validMutationOrigin(req,origin)) return json(403,{error:'このサイトからログアウトしてください。'});
        res.setHeader('Set-Cookie',sessionCookie('',config.production,true));return json(200,{authenticated:false});
      }
      if(pathname==='/api/auth/session' && req.method==='GET') return json(authenticated?200:401,{authenticated});
      if(get && (pathname==='/login' || (pathname==='/' && !authenticated))) return await file('auth/login.html');
      if(!authenticated) return json(401,{error:'ログインが必要です。'});
      if(pathname==='/api/config' && req.method==='GET') return json(200,{hasKey:!!config.apiKey,model:config.model});
      if(pathname==='/api/analyze' && req.method==='POST') {
        if(!validMutationOrigin(req,origin)) return json(403,{error:'アプリの画面から実行してください。'});
        if(!config.apiKey) return json(503,{error:'サーバーのOPENAI_API_KEYを設定してください。'});
        if(generating) return json(429,{error:'別の生成が進行中です。完了後に再実行してください。'});
        generating=true;
        try {
          const input=await readJson(req,1000000);
          return json(200,await generate(input,config.apiKey,undefined,undefined,config.model));
        } finally {generating=false;}
      }
      if(get && protectedFiles.has(pathname)) return await file(protectedFiles.get(pathname));
      return json(404,{error:'見つかりません。'});
    } catch(error) { return json(error.status || 502,{error:error.status ? error.message : '処理に失敗しました。設定を確認して再実行してください。'}); }
  };
}
export default createHandler();
