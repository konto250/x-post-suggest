const form=document.getElementById('login-form');
const message=document.getElementById('message');
const password=document.getElementById('password');
const destination=()=>'/'+location.search+location.hash;
function openApp() {
  const target=destination();
  // 取り込み用フラグメントへの同一文書内移動を避け、認証済みHTMLを取得する。
  if(location.pathname==='/') history.replaceState(null,'','/login'+location.search+location.hash);
  location.replace(target);
}
async function checkSession() {
  try {
    const response=await fetch('/api/auth/session',{cache:'no-store',credentials:'same-origin'});
    if(response.ok) {openApp();return;}
    if(response.status!==401) throw new Error('サーバーの認証設定を確認してください。');
    message.textContent='';form.hidden=false;password.focus();
  } catch(error) {message.textContent=error.message || '接続できません。ページを再読み込みしてください。';}
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=form.querySelector('button');button.disabled=true;
  try {
    const response=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:password.value})});
    password.value='';
    const result=await response.json();
    if(!response.ok) throw new Error(result.error || 'ログインできませんでした。');
    openApp();
  } catch(error) {password.value='';message.textContent=error.message || '接続できません。';button.disabled=false;}
});
window.addEventListener('pageshow',event=>{if(event.persisted) {password.value='';form.hidden=true;checkSession();}});
checkSession();
