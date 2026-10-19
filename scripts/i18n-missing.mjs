// Lists t('…') keys and card/tool labels with no zh-TW translation.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const files = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && files.push(p); } };
walk('src');
const dict = readFileSync('src/i18n/zh-tw.ts', 'utf8');
const have = new Set([...dict.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map(m => m[1]));
const keys = new Set();
for (const f of files) {
  if (f.includes('i18n')) continue;
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  for (const m of s.matchAll(/\blabel: '((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  for (const m of s.matchAll(/placeholder: '((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  for (const m of s.matchAll(/\['(left|center|right)', '([^']+)'\]/g)) keys.add(m[2]);
}
const missing = [...keys].filter(k => !have.has(k) && /[A-Za-z]{2}/.test(k) && !k.startsWith('.'));
console.log(missing.join('\n'));
