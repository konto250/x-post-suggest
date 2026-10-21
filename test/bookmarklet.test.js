import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { bookmarklet } from '../src/bookmarklet.js';
test('詳細ページの対象ポストのみを取り込み、絵文字・リンクを保持する',() => {
  const {document} = parseHTML(`<html><body>
    <article data-testid="tweet"><a href="https://x.com/other/status/9"><time></time></a><div data-testid="tweetText">別の投稿</div><a href="https://x.com/alice/status/123"><time></time></a></article>
    <article data-testid="tweet"><a href="https://x.com/alice/status/123"><time></time></a><div data-testid="tweetText">こんにちは<img alt="😊"> #話題 <a href="https://t.co/abc" title="https://example.com/article">記事</a></div></article>
  </body></html>`);
  let destination;
  const code=decodeURIComponent(bookmarklet('http://localhost:4317').slice('javascript:'.length));
  vm.runInNewContext(code,{document,location:{hostname:'x.com',origin:'https://x.com',pathname:'/alice/status/123'},URL,window:{open:url => destination=url},alert:message => {throw new Error(message);}});
  const data=JSON.parse(decodeURIComponent(destination.split('#import=')[1]));
  assert.match(data.text,/こんにちは😊/);assert.doesNotMatch(data.text,/別の投稿/);assert.deepEqual(data.links,['https://example.com/article']);assert.equal(data.url,'https://x.com/alice/status/123');
});
test('タイムラインでは誤ったポストを選ばず、詳細ページへの移動を促す',() => {
  let message;
  vm.runInNewContext(decodeURIComponent(bookmarklet('http://localhost:4317').slice(11)),{location:{hostname:'x.com',pathname:'/home'},alert:text => message=text});
  assert.match(message,/詳細ページ/);
});
