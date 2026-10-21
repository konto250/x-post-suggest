import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { validAccessToken } from '../server/auth.js';
const file=new URL('../.env.local',import.meta.url);
let content='';try {content=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
const env=parseEnv(content.replace(/^\uFEFF/,''));
if(validAccessToken(env.APP_ACCESS_TOKEN))console.log('既存のAPP_ACCESS_TOKENを維持しました（値は表示しません）。');
else {
  const clean=content.replace(/^\s*(?:export\s+)?APP_ACCESS_TOKEN\s*=.*(?:\r?\n|$)/gm,'');
  await writeFile(file,clean.trimEnd()+'\nAPP_ACCESS_TOKEN='+randomBytes(32).toString('base64url')+'\n',{mode:0o600});
  console.log('.env.local にランダムなAPP_ACCESS_TOKENを設定しました（値は表示しません）。');
}
console.log('OpenAI APIキー設定済み:',Boolean(env.OPENAI_API_KEY));
