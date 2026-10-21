import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export function createConfigReader({env = process.env, file = new URL('../.env.local', import.meta.url)} = {}) {
  return async function readConfig() {
    let local = {};
    try { if (!env.VERCEL) local = parseEnv((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('.env.local を読み込めません。ファイルの形式とアクセス権を確認してください。'); }
    const value = (name, fallback = '') => String(env[name] || local[name] || fallback).trim();
    return {apiKey:value('OPENAI_API_KEY'),model:value('OPENAI_MODEL','gpt-5-mini'),port:Number(value('PORT','4317')),accessToken:value('APP_ACCESS_TOKEN'),production:env.VERCEL === '1' || env.NODE_ENV === 'production',origins:[value('APP_ORIGIN'),env.VERCEL_URL && `https://${env.VERCEL_URL}`,env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`].filter(Boolean)};
  };
}

export const readConfig = createConfigReader();
