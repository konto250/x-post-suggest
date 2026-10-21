export function capturePost(destination) {
  try {
    if (!/^(www\.)?(x|twitter)\.com$/.test(location.hostname)) throw new Error('Xのポスト詳細ページで実行してください。');
    const match = location.pathname.match(/^\/([\w]+)\/status\/(\d+)/);
    if (!match) throw new Error('返信したいポストをクリックし、詳細ページで実行してください。');
    const article = [...document.querySelectorAll('article[data-testid="tweet"]')].find(el => {
      const a = el.querySelector('time')?.closest('a[href]');
      return a && new RegExp('/status/' + match[2] + '$').test(new URL(a.href, location.origin).pathname);
    });
    if (!article) throw new Error('対象ポストを読み取れません。ポストの読み込み後に再実行してください。');
    const body = article.querySelector('[data-testid="tweetText"]');
    if (!body) throw new Error('本文が見つかりません。本文のあるポストで実行してください。');
    const clone = body.cloneNode(true);
    clone.querySelectorAll('img[alt]').forEach(img => img.replaceWith(document.createTextNode(img.alt)));
    const text = clone.innerText || clone.textContent;
    const links = [...body.querySelectorAll('a[href]')].filter(a => /^https?:/.test(a.href) && !/^(www\.)?(x|twitter)\.com$/.test(new URL(a.href).hostname)).map(a => /^https?:\/\//.test(a.title) ? a.title : a.href);
    const data = {url: `https://x.com/${match[1]}/status/${match[2]}`, text, links, name: article.querySelector('[data-testid="User-Name"]')?.innerText?.split('\n')[0] || match[1]};
    const payload = encodeURIComponent(JSON.stringify(data));
    if (payload.length > 100000) throw new Error('本文が大きすぎます。アプリの手動入力を使ってください。');
    window.open(destination + '#import=' + payload, '_blank', 'noopener');
  } catch (error) { alert(error.message); }
}
export function bookmarklet(origin) { return 'javascript:' + encodeURIComponent(`(${capturePost.toString()})(${JSON.stringify(origin + '/')})`); }
