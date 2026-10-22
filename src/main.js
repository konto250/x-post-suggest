import { defaults, normalizePost, settingsFrom, prune, contextFor, loadState, saveState, STORAGE_KEY, safeUrl, recordId } from './core.js';
import { bookmarklet } from './bookmarklet.js';
import { apiFetch, checkSession, logout } from './session.js';
import { analysisKey, cachedAnalysis } from './analysis-cache.js';
if (!await checkSession()) throw new Error('ログインが必要です。');
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let state = {settings:{...defaults}, records:[]}, result = null, airResult = null, busy = false, storageBroken = false;
const kindLabel=record=>record.kind==='air-reply'?'エアリプ':'返信';
function notice(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'error' : ''; $('notice').hidden = false; }
try { state = loadState(localStorage); } catch(e) { storageBroken = true; notice(`保存データを読み込めません。既存データを保護するため保存を停止しています。${e.message}`,true); }
async function commit(change) {
  if (storageBroken) throw new Error('保存データが読み込めないため保存できません。');
  await navigator.locks.request('x-post-suggest-save', () => {
    const latest = loadState(localStorage);
    change(latest);
    latest.records = prune(latest.records,latest.settings);
    try { saveState(localStorage,latest); } catch { throw new Error('保存に失敗しました。空き容量やブラウザーの保存許可を確認してください。現在の入力は画面に残っています。'); }
    state = latest;
  });
  updateCounts(); renderHistory();
}
function go(view) {
  document.querySelectorAll('.view').forEach(n => n.hidden = n.id !== view);
  document.querySelectorAll('[data-view]').forEach(n => n.classList.toggle('active',n.dataset.view === view));
  $('breadcrumb').textContent = 'ワークスペース / ' + ({compose:'返信を考える',history:'やりとりの履歴',settings:'設定・はじめかた'}[view]);
  if (view === 'history') renderHistory();
  if (view === 'settings') refreshApiConfig();
}
document.querySelectorAll('[data-view]').forEach(n => n.addEventListener('click',() => go(n.dataset.view)));
function currentPost() { return normalizePost({url:$('post-url').value,text:$('post-text').value,links:$('post-links').value.split(/\n/).map(x => x.trim()).filter(Boolean)}); }
function updateCounts() { $('history-count').textContent = state.records.length; $('account-label').textContent = state.settings.ownHandle ? '@' + state.settings.ownHandle : '自分専用'; }
function renderContext() {
  $('context-list').replaceChildren(); $('post-meta').replaceChildren();
  try {
    const post = currentPost(); const context = contextFor(state.records,post,state.settings);
    const saved=state.records.filter(r=>r.post.author===post.author);
    const current=saved.filter(r=>r.post.id===post.id);
    const drafts=saved.filter(r=>r.post.id!==post.id && r.status==='draft');
    $('context-summary').textContent = `@${post.author} との保存履歴は${saved.length}件。次の生成には、別ポストに関する返信済みの記録${context.length}件（返信・エアリプ）を使用します。`;
    [ '@'+post.author, ...post.hashtags, `${post.links.length}件のリンク` ].forEach(t => $('post-meta').append(el('span',t,'tag')));
    for(const r of current) {
      const item=el('div',undefined,'context-item');
      item.append(el('strong',`このポストへの保存済み${kindLabel(r)}（${r.status==='sent'?'返信済み':'下書き'}）`),el('br'),el('span',r.reply),el('p','現在開いている同じポストの記録なので、次の生成の参照対象には含めません。','fine-print'));
      $('context-list').append(item);
    }
    if(drafts.length)$('context-list').append(el('p',`別ポストへの下書き${drafts.length}件は参照対象外です。「Xで返信する」または「Xでエアリプする」を押すと返信済みになり、次回の文脈に使われます。`,'fine-print'));
    if(context.length)$('context-list').append(el('p','次の生成に使う、別ポストでのやりとり','muted'));
    context.slice(0,3).forEach(c => { const item = el('div',undefined,'context-item'); item.append(el('span',c.post.slice(0,110)),el('br'),el('strong',`↳ ${kindLabel(c)}：${c.reply.slice(0,180)}`)); $('context-list').append(item); });
  } catch { $('context-summary').textContent = 'ポストURLと本文を入力すると、相手への返信履歴が表示されます。'; }
}
const emptySuggestions = $('suggestions').cloneNode(true);
function clearAir() { airResult=null; $('air-panel').hidden=true; $('air-suggestions').replaceChildren(); $('air-text').value=''; }
function clearResult() { result = null; $('regenerate').hidden=true; $('suggestions').replaceChildren(...emptySuggestions.cloneNode(true).childNodes); clearAir(); }
for (const id of ['post-url','post-text','post-links']) $(id).addEventListener('input',() => { clearResult(); renderContext(); });
function fillPost(post, reply = '', analysis = null) {
  clearAir();
  $('post-url').value = post.url; $('post-text').value = post.text; $('post-links').value = post.links.join('\n'); $('reply').value = reply; updateChars(); result = analysis; analysis ? renderResult(analysis) : clearResult(); renderContext(); go('compose');
}
$('new-post').addEventListener('click',() => {
  if (busy) return;
  if (($('reply').value || $('air-text').value) && !confirm('現在の編集内容を閉じて、新しい返信を作成しますか？ 保存済みの履歴は残ります。')) return;
  $('post-form').reset(); $('reply').value = ''; $('tone').value = defaults.tone; clearResult(); renderContext(); updateChars();
});
$('bookmark').href = bookmarklet(location.origin);
$('bookmark').addEventListener('click', e => { e.preventDefault(); notice('このリンクをブックマークバーへドラッグし、Xのポスト詳細ページで起動してください。'); });
async function copy(text, message) { try { await navigator.clipboard.writeText(text); notice(message); } catch { notice('コピーできませんでした。文字を選択して手動でコピーしてください。',true); } }
$('copy-bookmark').addEventListener('click',() => copy(bookmarklet(location.origin),'ブックマークレットをコピーしました。ブックマークのURL欄に貼り付けてください。'));
function importHash() {
  if (!location.hash.startsWith('#import=')) return;
  if (busy) { notice('生成中は別のポストを取り込めません。完了後に再実行してください。',true); return; }
  try {
    if (location.hash.length > 100008) throw new Error('取り込みデータが大きすぎます。');
    const post = normalizePost(JSON.parse(decodeURIComponent(location.hash.slice(8))));
    history.replaceState(null,'',location.pathname);
    fillPost(post); notice('ポストを取り込みました。本文・リンク先を確認して返信案を生成してください。');
  } catch(e) { history.replaceState(null,'',location.pathname); notice('取り込み失敗：'+e.message,true); }
}
function renderResult(data) {
  $('regenerate').hidden=false;
  const container = $('suggestions'); container.replaceChildren(el('p',data.summary,'summary'));
  if (data.caution) container.append(el('p',data.caution,'warning'));
  data.suggestions.forEach(s => {
    const card = el('div',undefined,'suggestion'); const button = el('button','この案を使う','text-button'); button.type = 'button';
    button.addEventListener('click',() => { $('reply').value = s.text; updateChars(); $('reply').focus(); });
    card.append(el('h3',s.label),el('p',s.text),button); container.append(card);
  });
  if (data.links?.length) {
    container.append(el('h3','リンク先の確認結果'));
    for (const l of data.links) {
      const box = el('div',undefined,'link-result'); const url = safeUrl(l.finalUrl || l.url);
      if (url) { const a = el('a',l.title || l.url); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; box.append(a); }
      box.append(el('p',(l.status === 'fetched' ? '取得済み · ' : '未確認 · ') + l.note));
      if (l.text) { const details = el('details'); details.append(el('summary','AIに渡したテキストを見る'),el('pre',l.text)); box.append(details); }
      container.append(box);
    }
  }
  container.append(el('p',`同じ相手のポストに関する返信済みの記録 ${data.contextCount || 0}件（返信・エアリプ）を参照しました。`,'fine-print'));
  if(data.inputNotice)container.append(el('p',data.inputNotice,'fine-print'));
  if(data.generatedAt)container.append(el('p',`生成日時：${new Date(data.generatedAt).toLocaleString('ja-JP')}。リンク先はこの時点の取得内容です。`,'fine-print'));
}
function renderAirResult(data) {
  airResult=data;
  const container=$('air-suggestions');container.replaceChildren(el('p',data.summary,'summary'));
  if(data.caution)container.append(el('p',data.caution,'warning'));
  for(const suggestion of data.suggestions) {
    const card=el('div',undefined,'suggestion');const use=el('button','この案を使う','text-button');use.type='button';
    use.addEventListener('click',()=>{if(busy)return;$('air-text').value=suggestion.text;$('air-text').focus();});
    card.append(el('h3',suggestion.label),el('p',suggestion.text),use);container.append(card);
  }
  container.append(el('p',data.inputNotice,'fine-print'));
  container.append(el('p',`返信済みの記録 ${data.contextCount || 0}件（返信・エアリプ）を参照しました。`,'fine-print'));
  if(data.generatedAt)container.append(el('p',`生成日時：${new Date(data.generatedAt).toLocaleString('ja-JP')}`,'fine-print'));
  $('air-text').value=data.suggestions[0].text;$('air-panel').hidden=false;
  $('air-panel').scrollIntoView({block:'nearest'});
}
function setBusy(value) {
  busy = value;
  for (const id of ['post-url','post-text','post-links','tone','generate','regenerate','self-debate','regenerate-air','air-text','open-air','copy-air','save-air','new-post','save-draft','open-x']) $(id).disabled = value;
  $('generate').textContent = value ? 'リンク先を確認して返信案を生成中…' : '✧ 返信案をつくる';
  $('suggestions').setAttribute('aria-busy',String(value));
}
$('post-form').addEventListener('submit',async e => {
  e.preventDefault(); if (busy) return;
  try {
    const mode=['self-debate','regenerate-air'].includes(e.submitter?.id)?'air-reply':'reply';
    const force=['regenerate','regenerate-air'].includes(e.submitter?.id);
    const label=mode==='air-reply'?'エアリプ案':'返信案';
    const post = currentPost(); state = loadState(localStorage); const settings = {...state.settings,tone:$('tone').value};
    if(mode==='air-reply' && $('air-text').value && !confirm('編集中のエアリプを生成結果で置き換えますか？'))return;
    setBusy(true); notice(force ? `新しい${label}を生成します（API利用料が発生します）。` : `保存済みの${label}を確認しています。`);
    const configResponse=await apiFetch('/api/config');
    const config=await configResponse.json();if(!configResponse.ok)throw new Error(config.error || '設定を確認できません。');
    const input={mode,post,settings:{ownHandle:settings.ownHandle,tone:mode==='air-reply'?'短くカジュアル':settings.tone,instruction:settings.instruction,context:settings.context},context:contextFor(state.records,post,settings)};
    const key=await analysisKey(input,config);
    const cached=await navigator.locks.request('x-post-suggest:generate:'+key,()=>cachedAnalysis({storage:localStorage,key,force,generate:async()=>{
      notice(mode==='air-reply'?'元ポストとリンク先を確認し、冷笑系エアリプ案を生成しています。':'リンク先と過去の返信を確認し、返信案を生成しています。');
      const response=await apiFetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(150000)});
      const data=await response.json();if(!response.ok)throw new Error(data.error || '生成に失敗しました。');return data;
    }}));
    if(mode==='air-reply')renderAirResult(cached.data);else {result=cached.data;renderResult(cached.data);}
    notice(cached.reused ? `保存済みの${label}を再利用しました。追加のOpenAI API利用料はかかりません。` : cached.saved ? `3つの${label}を作成しました。同じ条件なら24時間、追加課金なしで再利用できます。` : `${label}を作成しましたが、ブラウザーに再利用用の保存ができませんでした。再実行にはAPI利用料がかかります。`);
  } catch(e) { notice(e.name === 'TimeoutError' ? '生成がタイムアウトしました。再実行してください。' : e.message,true); }
  finally {setBusy(false);}
});
function updateChars() { $('char-count').textContent = `${[...$('reply').value].length}文字（Xでのカウントとは異なる場合があります）`; }
$('reply').addEventListener('input',updateChars);
$('copy-reply').addEventListener('click',() => { if ($('reply').value.trim()) copy($('reply').value,'返信をコピーしました。'); else notice('返信を入力してください。',true); });
$('copy-air').addEventListener('click',()=>{if($('air-text').value.trim())copy($('air-text').value,'エアリプをコピーしました。');else notice('投稿するコメントを入力してください。',true);});
$('save-air').addEventListener('click',()=>saveReply('draft','air-reply').catch(e=>notice(e.message,true)));
$('open-air').addEventListener('click',async()=>{
  if(busy)return;
  const text=$('air-text').value.trim();if(!text){notice('投稿するコメントを入力してください。',true);return;}
  const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;
  try {
    await saveReply('sent','air-reply');
    if(tab){tab.location.href='https://x.com/intent/tweet?'+new URLSearchParams({text});notice('エアリプを返信済みとして記録してXを開きました。投稿はXで確定してください。');}
    else notice('エアリプを返信済みとして記録しました。ポップアップを許可するか、コメントをコピーしてXに貼り付けてください。',true);
  }catch(e){tab?.close();notice(e.message,true);}
});
async function saveReply(status,kind='reply') {
  const post = currentPost(); const reply = $(kind==='air-reply'?'air-text':'reply').value.trim();
  if (!reply) throw new Error('保存する返信を入力してください。');
  const selectedResult=kind==='air-reply'?airResult:result;
  const analysis = selectedResult ? {...selectedResult,links:selectedResult.links?.map(({text, ...link}) => link)} : null;
  const record = {id:recordId(post,kind),kind,post,reply,status,analysis,updatedAt:new Date().toISOString()};
  await commit(latest => {latest.records = [record,...latest.records.filter(r => r.id !== record.id)];});
  renderContext(); notice(kind==='air-reply' ? (status==='sent'?'エアリプを返信済みとして記録しました。次回の生成に活用します。':'エアリプの下書きを保存しました。') : (status === 'sent' ? '返信済みとして記録しました。次回、この相手への返信に活用します。' : '下書きを保存しました。')); return post;
}
$('save-draft').addEventListener('click',() => saveReply('draft').catch(e => notice(e.message,true)));
$('open-x').addEventListener('click',async () => {
  try {
    const post = currentPost(); if (!$('reply').value.trim()) throw new Error('返信を入力してください。');
    const tab = window.open('about:blank','_blank'); if (tab) tab.opener = null;
    try { await saveReply('sent'); } catch(e) {tab?.close(); throw e;}
    const url = `https://x.com/intent/tweet?in_reply_to=${encodeURIComponent(post.id)}&text=${encodeURIComponent($('reply').value)}`;
    if (tab) {tab.location.href = url;notice('返信済みとして記録してXを開きました。投稿はXで確定してください。');} else notice('返信済みとして記録しました。ポップアップを許可するか、返信をコピーしてXに貼り付けてください。',true);
  } catch(e) { notice(e.message,true); }
});
function renderHistory() {
  const selected = $('user-filter').value;
  $('user-filter').replaceChildren(new Option('すべての相手',''));
  [...new Set(state.records.map(r => r.post.author))].sort().forEach(user => $('user-filter').append(new Option('@'+user,user)));
  $('user-filter').value = selected;
  const query = $('search').value.toLowerCase(); const status = $('status-filter').value; const user = $('user-filter').value;
  const records = state.records.filter(r => (!user || user === r.post.author) && (status === 'all' || r.status === status) && (r.post.author+' '+r.post.text+' '+r.reply).toLowerCase().includes(query));
  const container = $('history-list'); container.replaceChildren();
  if (!records.length) { const empty = el('div',undefined,'panel empty-state'); empty.append(el('h3','まだ、ここにはことばがありません。'),el('p','返信を保存すると、元のポストと一緒に並びます。')); container.append(empty); }
  for (const r of records) {
    const card = el('article',undefined,'panel history-card'); const heading = el('div',undefined,'panel-heading');
    const a = el('a','@'+r.post.author); a.href = r.post.url; a.target = '_blank'; a.rel='noopener noreferrer'; heading.append(a,el('span',`${kindLabel(r)} · ${r.status === 'sent' ? '返信済み' : '下書き'} · ${new Date(r.updatedAt).toLocaleString('ja-JP')}`,'subtle'));
    const pair = el('div',undefined,'history-pair'); const left = el('div'); const right = el('div'); left.append(el('span','元のポスト','subtle'),el('p',r.post.text)); right.append(el('span','自分の'+kindLabel(r),'subtle'),el('p',r.reply)); pair.append(left,right);
    const buttons = el('div',undefined,'actions'); const edit = el('button','開いて編集','secondary'); edit.addEventListener('click',() => {
      if(busy){notice('生成完了後に開いてください。',true);return;}
      if(r.kind==='air-reply'){fillPost(r.post);if(r.analysis)renderAirResult(r.analysis);$('air-panel').hidden=false;$('air-text').value=r.reply;}
      else fillPost(r.post,r.reply,r.analysis);
    });
    const remove = el('button','削除','text-button'); remove.addEventListener('click',async () => { if (!confirm('この元投稿と返信の記録を削除しますか？')) return; try {await commit(latest => {latest.records = latest.records.filter(x => x.id !== r.id);}); renderContext(); notice('記録を削除しました。');} catch(e) {notice(e.message,true);} }); buttons.append(edit,remove); card.append(heading,pair,buttons); container.append(card);
  }
}
['search','status-filter','user-filter'].forEach(id => $(id).addEventListener('input',renderHistory));
function fillSettings() { const s = state.settings; $('own-handle').value=s.ownHandle; $('instruction').value=s.instruction; $('per-user').value=s.perUser; $('total').value=s.total; $('context-limit').value=s.context; $('tone').value=s.tone; updateCounts(); }
$('settings-form').addEventListener('submit',async e => {
  e.preventDefault();
  const settings = settingsFrom({ownHandle:$('own-handle').value,instruction:$('instruction').value,perUser:$('per-user').value,total:$('total').value,context:$('context-limit').value,tone:$('tone').value});
  try { await commit(latest => { if (prune(latest.records,settings).length < latest.records.length && !confirm('上限の変更により古い履歴が削除されます。設定を保存しますか？')) throw new Error('設定の変更を取り消しました。'); latest.settings=settings; }); fillSettings();renderContext();notice('設定を保存しました。'); } catch(e) {notice(e.message,true);}
});
function downloadBackup() {
  try {
    const raw=localStorage.getItem(STORAGE_KEY) || JSON.stringify({version:1,...state});
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
    const a=el('a');a.href=url;a.download=`x-replies-${new Date().toISOString().slice(0,10)}.json`;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notice(`「${a.download}」のダウンロードを開始しました。通常は「ダウンロード」フォルダーに保存されます。見つからない場合はブラウザーのダウンロード一覧を確認してください。`);
  } catch(e) {notice('バックアップをダウンロードできません：'+e.message,true);}
}
$('export').addEventListener('click',downloadBackup);
$('export-settings').addEventListener('click',downloadBackup);
$('restore').addEventListener('change',async e => {
  try {
    const file = e.target.files[0]; if (!file) return; if(file.size > 10000000) throw new Error('ファイルが大きすぎます（最大10MB）。');
    const raw = await file.text(); const restored = loadState({getItem:() => raw});
    if (!confirm(`${restored.records.length}件の履歴と設定で、現在の保存データを置き換えますか？`)) return;
    await navigator.locks.request('x-post-suggest-save',() => saveState(localStorage,restored)); state=restored; storageBroken=false; fillSettings();renderHistory();renderContext();notice('バックアップを復元しました。');
  } catch(error) {notice('復元できません：'+error.message,true);} finally {e.target.value='';}
});
window.addEventListener('storage',e => {if(e.key===STORAGE_KEY){try{state=loadState(localStorage);storageBroken=false;updateCounts();renderHistory();renderContext();}catch(error){storageBroken=true;notice(error.message,true);}}});
window.addEventListener('hashchange',importHash);
fillSettings(); $('tone').value=defaults.tone; renderHistory(); importHash();
async function refreshApiConfig() {
  try {
    const response = await apiFetch('/api/config');
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || 'API設定を読み込めません。');
    $('api-state').textContent=`使用モデル：${config.model} / ${config.hasKey ? 'サーバーのAPIキーを使用します' : 'サーバーのOPENAI_API_KEYを設定してください'}`;
  } catch(error) { $('api-state').textContent='設定を確認できません。サーバーの起動状態を確認してください。' + error.message; }
}
window.addEventListener('focus',refreshApiConfig);
refreshApiConfig();
$('logout').addEventListener('click',()=>logout().catch(error=>notice(error.message,true)));
