import './verify-live.mjs';
import { inspectLink } from '../server/links.js';
const link=await inspectLink('https://example.com');
if(link.status!=='fetched')throw new Error('公開リンクを取得できませんでした。');
console.log('公開リンク取得: 成功');
