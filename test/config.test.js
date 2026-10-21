import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConfigReader } from '../server/config.js';

test('起動後に追加・更新した.env.localを次の読み込みで反映する',async t => {
  const directory = await mkdtemp(path.join(tmpdir(),'x-post-config-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const file = path.join(directory,'.env.local');
  const read = createConfigReader({env:{},file});
  assert.equal((await read()).apiKey,'');
  await writeFile(file,'\uFEFFOPENAI_API_KEY="dummy-first"\nOPENAI_MODEL=test-model\nPORT=4399');
  assert.deepEqual(await read(),{apiKey:'dummy-first',model:'test-model',port:4399,accessToken:'',production:false,origins:[]});
  await writeFile(file,'OPENAI_API_KEY=dummy-second');
  assert.deepEqual(await read(),{apiKey:'dummy-second',model:'gpt-5-mini',port:4317,accessToken:'',production:false,origins:[]});
  await writeFile(file,'OPENAI_API_KEY=');
  assert.equal((await read()).apiKey,'');
});

test('明示した環境変数はローカルファイルより優先する',async t => {
  const directory = await mkdtemp(path.join(tmpdir(),'x-post-config-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const file = path.join(directory,'.env.local');
  await writeFile(file,'OPENAI_API_KEY=dummy-file');
  const read = createConfigReader({env:{OPENAI_API_KEY:'dummy-env'},file});
  assert.equal((await read()).apiKey,'dummy-env');
});
