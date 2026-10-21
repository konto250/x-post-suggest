import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { parseHTML } from 'linkedom';

export function isPublicIPv4(ip) {
  const a = ip.split('.').map(Number);
  if (a.length !== 4 || a.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [x,y] = a;
  return !(x === 0 || x === 10 || x === 127 || x >= 224 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && [0,168].includes(y)) || (x === 100 && y >= 64 && y <= 127) || (x === 198 && [18,19,51].includes(y)) || (x === 203 && y === 0));
}
async function fetchPage(value, redirects = 0) {
  const url = new URL(value);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw new Error('取得対象外のURLです');
  const addresses = await lookup(url.hostname, {all: true, family: 4});
  if (!addresses.length || addresses.some(a => !isPublicIPv4(a.address))) throw new Error('公開サイトのURLのみ取得できます');
  const address = addresses[0].address;
  const result = await new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, {headers: {'User-Agent':'XPostSuggest/1.0', 'Accept':'text/html,text/plain', 'Accept-Encoding':'identity'}, lookup: (_host, options, cb) => options.all ? cb(null, [{address, family:4}]) : cb(null,address,4)}, response => {
      if ([301,302,303,307,308].includes(response.statusCode)) { response.resume(); resolve({redirect: response.headers.location}); return; }
      if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); reject(new Error(`HTTP ${response.statusCode}`)); return; }
      if (!/text\/(html|plain)|application\/xhtml\+xml/.test(response.headers['content-type'] || '')) { response.resume(); reject(new Error('HTML・テキスト以外のページです')); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 1500000) request.destroy(new Error('ページサイズが上限を超えています')); else chunks.push(chunk); });
      response.on('end', () => resolve({html: Buffer.concat(chunks).toString('utf8'), url: url.href}));
      response.on('error', reject);
    });
    const timer = setTimeout(() => request.destroy(new Error('取得がタイムアウトしました')), 10000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
  if (result.redirect) { if (redirects >= 4) throw new Error('転送回数が上限を超えています'); return fetchPage(new URL(result.redirect, url).href, redirects + 1); }
  if (!result.html) throw new Error('本文を取得できません');
  return result;
}
export async function inspectLink(url) {
  try {
    const page = await fetchPage(url);
    const {document} = parseHTML(page.html);
    document.querySelectorAll('script,style,nav,footer,header,noscript,svg').forEach(el => el.remove());
    const title = document.querySelector('title')?.textContent?.trim() || '';
    const body = document.querySelector('article') || document.querySelector('main') || document.body;
    const text = (body?.textContent || '').replace(/\s+/g,' ').trim().slice(0, 12000);
    if (text.length < 80) throw new Error('本文が短いため確認できません（ログインやJavaScriptが必要な可能性があります）');
    return {url, finalUrl: page.url, title, text, status:'fetched', note:'取得できたテキストのみ確認対象です。画像・動画・ログイン後の情報は含みません。'};
  } catch (e) { return {url, status:'unavailable', note: e.message}; }
}
