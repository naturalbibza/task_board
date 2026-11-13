// Сканирует исходники на признаки двойного перекодирования (кракозябры).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['packages/server/src', 'packages/client/src', 'packages/shared/src'];
const badChars = /[µѓїђљњћќџ‡‹›]/;
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (/\.(ts|tsx|mjs)$/.test(name)) {
      const text = readFileSync(full, 'utf8');
      if (badChars.test(text)) hits.push(full);
    }
  }
}

for (const r of roots) walk(r);
console.log(hits.length ? `ПОВРЕЖДЕНЫ:\n${hits.join('\n')}` : 'OK — повреждений не найдено');
