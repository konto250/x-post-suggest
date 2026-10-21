import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { validAccessToken } from '../server/auth.js';
const local=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));
const cli=process.argv[2];
if(!cli)throw new Error('インストール済みVercel CLIのエントリーファイルを指定してください。');
if(!validAccessToken(local.APP_ACCESS_TOKEN)||!local.OPENAI_API_KEY)throw new Error('ローカルの認証設定とAPIキーを確認してください。');
for(const name of ['APP_ACCESS_TOKEN','OPENAI_API_KEY']) {
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,'env','add',name,'--environment','production','--sensitive','--yes'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    child.stdout.resume();child.stderr.resume();child.on('error',reject);child.on('exit',resolve);
    child.stdin.on('error',()=>{});child.stdin.end(local[name]+'\n');
  });
  if(code!==0)throw new Error(`${name} の登録に失敗しました。値は表示していません。vercel env lsで設定状態を確認してください。`);
  console.log(`${name}: Production環境にシークレットとして登録しました。`);
}
