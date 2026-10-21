export const STORAGE_KEY = 'x-post-suggest:v1';
export const defaults = { ownHandle: '', perUser: 20, total: 500, context: 10, tone: '自然で親しみやすい', instruction: '' };
export const handle = value => String(value || '').trim().replace(/^@/, '').toLowerCase();
export function safeUrl(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function normalizePost(raw) {
  const url = safeUrl(raw.url);
  const match = url && new URL(url).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
  if (!url || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(new URL(url).hostname) || !match) throw new Error('XのポストURLを入力してください。');
  const author = handle(match[1]);
  const text = String(raw.text || '').trim().slice(0, 25000);
  if (!text) throw new Error('ポスト本文を入力してください。');
  const links = [...new Set([...(Array.isArray(raw.links) ? raw.links : []), ...(text.match(/https?:\/\/[^\s<>]+/g) || [])].map(safeUrl).filter(Boolean))].slice(0, 8);
  const hashtags = [...new Set(text.match(/[#＃][\p{L}\p{N}_]+/gu) || [])];
  return { id: match[2], url: `https://x.com/${author}/status/${match[2]}`, author, name: String(raw.name || author).slice(0, 100), text, links, hashtags };
}
export function settingsFrom(raw = {}) {
  const n = (key, min, max) => Math.max(min, Math.min(max, Math.floor(Number(raw[key]) || defaults[key])));
  return { ownHandle: handle(raw.ownHandle).slice(0, 15), perUser: n('perUser', 1, 100), total: n('total', 1, 1000), context: n('context', 1, 20), tone: String(raw.tone || defaults.tone).slice(0, 100), instruction: String(raw.instruction || '').slice(0, 2000) };
}
export function prune(records, settings) {
  const counts = new Map();
  return [...records].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).filter(r => {
    const key = handle(r.post.author); const count = counts.get(key) || 0; counts.set(key, count + 1); return count < settings.perUser;
  }).slice(0, settings.total);
}
export function contextFor(records, post, settings) {
  return records.filter(r => handle(r.post.author) === post.author && r.post.id !== post.id && r.status === 'sent' && r.reply.trim()).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, settings.context).map(r => ({ post: r.post.text.slice(0, 6000), reply: r.reply.slice(0, 2000), date: r.updatedAt }));
}
export function loadState(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return { settings: {...defaults}, records: [] };
  const parsed = JSON.parse(raw);
  if (parsed.version !== 1 || !Array.isArray(parsed.records)) throw new Error('保存データの形式が不明です。バックアップを確認してください。');
  const settings = settingsFrom(parsed.settings);
  const records = parsed.records.map(r => {
    if (!r.id || !['draft','sent'].includes(r.status) || typeof r.updatedAt !== 'string' || !Number.isFinite(Date.parse(r.updatedAt)) || typeof r.reply !== 'string') throw new Error('履歴データが破損しています。');
    const analysis = r.analysis;
    if (analysis && (!Array.isArray(analysis.suggestions) || analysis.suggestions.some(s => !s || typeof s.text !== 'string' || typeof s.label !== 'string') || (analysis.links && (!Array.isArray(analysis.links) || analysis.links.some(l => !l || typeof l.url !== 'string'))))) throw new Error('保存された返信案の形式が不正です。');
    return { id: normalizePost(r.post).id, updatedAt: r.updatedAt, status:r.status, analysis: analysis || null, post: normalizePost(r.post), reply: r.reply.slice(0, 10000) };
  });
  return {settings, records: prune(records, settings)};
}
export function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, settings: state.settings, records: prune(state.records, state.settings) }));
}
