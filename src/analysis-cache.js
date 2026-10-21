import { ANALYSIS_VERSION, CACHE_TTL, CACHE_LIMIT } from './analysis-config.js';
export const CACHE_KEY='x-post-suggest:analysis-cache:v1';
export async function analysisKey(input,config) {
  const bytes=new TextEncoder().encode(JSON.stringify({version:ANALYSIS_VERSION,serverVersion:config.analysisVersion,model:config.model,input}));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function entries(storage,now) {
  try {
    const raw=JSON.parse(storage.getItem(CACHE_KEY)||'[]');
    if(!Array.isArray(raw))return [];
    return raw.filter(e=>typeof e.key==='string' && Number.isFinite(e.createdAt) && e.createdAt<=now && now-e.createdAt<CACHE_TTL && Array.isArray(e.data?.suggestions) && e.data.suggestions.length===3 && e.data.suggestions.every(s=>typeof s.text==='string' && typeof s.label==='string') && Array.isArray(e.data.links)).slice(-CACHE_LIMIT);
  } catch {return [];}
}
export function readCached(storage,key,now=Date.now()) {return entries(storage,now).find(e=>e.key===key)?.data || null;}
export function writeCached(storage,key,data,now=Date.now()) {
  try {
    const list=entries(storage,now).filter(e=>e.key!==key);
    list.push({key,createdAt:now,data});
    storage.setItem(CACHE_KEY,JSON.stringify(list.slice(-CACHE_LIMIT)));
    return true;
  } catch {return false;}
}
export async function cachedAnalysis({storage,key,generate,force=false,now=Date.now}) {
  if(!force) {const data=readCached(storage,key,now());if(data)return {data,reused:true,saved:true};}
  const data=await generate();
  return {data,reused:false,saved:writeCached(storage,key,data,now())};
}
