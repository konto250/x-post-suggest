import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const folders=['server','src','auth','api'];
for(const folder of folders) for(const file of await readdir(folder)) {
  if(!file.endsWith('.js'))continue;
  const result=spawnSync(process.execPath,['--check',`${folder}/${file}`],{encoding:'utf8',windowsHide:true});
  if(result.status!==0) {console.error(`${folder}/${file} の構文検証に失敗しました。`);process.exit(1);}
}
await mkdir('dist',{recursive:true});
if((await readdir('dist')).some(file=>file!=='robots.txt'))throw new Error('distにはアプリファイルを配置しないでください。アプリは認証付きFunctionで配信します。');
await writeFile('dist/robots.txt','User-agent: *\nDisallow: /\n');
console.log('本番準備完了: JavaScript構文確認済み。公開静的ファイルはrobots.txtのみです。');
