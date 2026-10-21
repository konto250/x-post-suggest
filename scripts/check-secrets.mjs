import { readFile, readdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
const root=process.cwd();
const local=parseEnv(await readFile('.env.local','utf8'));
const secrets=[local.APP_ACCESS_TOKEN,local.OPENAI_API_KEY,local.VERCEL_OIDC_TOKEN].filter(value=>value?.length>20);
async function scan(directory,skip=new Set()) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(skip.has(entry.name))continue;
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())await scan(file,skip);
    else if(entry.isFile()) {
      const content=await readFile(file);
      if(secrets.some(secret=>content.includes(Buffer.from(secret))))throw new Error('シークレットが配布対象ファイルに含まれています。出力を停止しました。');
    }
  }
}
await scan(root,new Set(['.git','.vercel','node_modules','.env.local','.server.log','.server-error.log']));
const staticFiles=await readdir('.vercel/output/static');
if(staticFiles.some(name=>name!=='robots.txt'))throw new Error('公開静的ディレクトリに想定外のファイルがあります。');
await scan(path.join(root,'.vercel/output'));
console.log('確認成功: ソース・Vercel配布物にシークレットなし。公開静的ファイルはrobots.txtのみ。');
