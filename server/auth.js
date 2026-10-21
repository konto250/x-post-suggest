import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export function validAccessToken(value) {
  return typeof value === 'string' && /^[\x21-\x7e]{32,512}$/.test(value) && new Set(value).size >= 12;
}
function digest(value) { return createHash('sha256').update(value).digest(); }
export function matchPassword(candidate, secret) {
  return validAccessToken(secret) && typeof candidate === 'string' && candidate.length <= 512 && timingSafeEqual(digest(candidate),digest(secret));
}
function signature(body,secret) { return createHmac('sha256',secret).update('x-post-suggest/session/v1\0'+body).digest('base64url'); }
export function issueSession(secret, now = Date.now()) {
  if (!validAccessToken(secret)) throw new Error('認証設定が不正です。');
  const issued = Math.floor(now/1000);
  const body = `v1.${issued}.${issued + SESSION_SECONDS}.${randomBytes(24).toString('base64url')}`;
  return body+'.'+signature(body,secret);
}
export function verifySession(token,secret,now=Date.now()) {
  if (!validAccessToken(secret) || typeof token !== 'string' || token.length > 256) return false;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1' || !/^\d{10}$/.test(parts[1]) || !/^\d{10}$/.test(parts[2]) || !/^[\w-]{32}$/.test(parts[3]) || !/^[\w-]{43}$/.test(parts[4])) return false;
  const issued = Number(parts[1]), expires = Number(parts[2]), seconds = Math.floor(now/1000);
  if (expires - issued !== SESSION_SECONDS || issued > seconds + 30 || expires <= seconds) return false;
  return timingSafeEqual(Buffer.from(parts[4]),Buffer.from(signature(parts.slice(0,4).join('.'),secret)));
}
export function cookieName(production) { return production ? '__Host-xps_session' : 'xps_session'; }
export function sessionFromRequest(req,production) {
  const name = cookieName(production)+'=';
  const matches = String(req.headers.cookie || '').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name));
  return matches.length === 1 ? matches[0].slice(name.length) : '';
}
export function sessionCookie(value,production,clear=false) {
  return `${cookieName(production)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${production ? '; Secure' : ''}${clear ? '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' : ''}`;
}
export function requestOrigin(req,config) {
  const origin = `${config.production ? 'https' : 'http'}://${req.headers.host}`;
  const allowed = config.production ? config.origins : [`http://localhost:${config.port}`,`http://127.0.0.1:${config.port}`];
  return allowed.includes(origin) ? origin : null;
}
export function validMutationOrigin(req,origin) {
  return Boolean(origin) && req.headers.origin === origin && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
}
export function createLoginLimiter({limit=5,windowMs=15*60*1000,now=Date.now}={}) {
  const attempts = new Map();
  return key => {
    const time=now();
    for(const [k,v] of attempts) if (v.reset <= time) attempts.delete(k);
    let entry=attempts.get(key);
    if (!entry) {
      if (attempts.size >= 10000) return {allowed:false,retryAfter:900};
      entry={count:0,reset:time+windowMs}; attempts.set(key,entry);
    }
    entry.count++;
    return {allowed:entry.count<=limit,retryAfter:Math.max(1,Math.ceil((entry.reset-time)/1000))};
  };
}
