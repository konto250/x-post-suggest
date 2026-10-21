const LOGOUT_SIGNAL='x-post-suggest:logout';
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('x-post-suggest:auth'):null;
let closing=false;
function closeApp() {
  if(closing)return;
  closing=true;
  document.body.replaceChildren();
  location.replace('/login'+location.search+location.hash);
}
export async function apiFetch(url,options={}) {
  const response=await fetch(url,{...options,credentials:'same-origin',cache:'no-store'});
  if(response.status===401) {closeApp();throw new Error('ログインの有効期限が切れました。');}
  return response;
}
export async function checkSession() {
  try {
    const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok) {closeApp();return false;}
    return true;
  } catch {closeApp();return false;}
}
export async function logout() {
  const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});
  if(!response.ok) throw new Error('ログアウトできませんでした。接続状態を確認して再実行してください。');
  channel?.postMessage('logout');
  try {localStorage.setItem(LOGOUT_SIGNAL,crypto.randomUUID());} catch {}
  closeApp();
}
if(channel)channel.onmessage=event=>{if(event.data==='logout')closeApp();};
window.addEventListener('storage',event=>{if(event.key===LOGOUT_SIGNAL)closeApp();});
window.addEventListener('focus',checkSession);
window.addEventListener('pagehide',()=>{document.documentElement.hidden=true;});
window.addEventListener('pageshow',async event=>{if(event.persisted && await checkSession())document.documentElement.hidden=false;});
