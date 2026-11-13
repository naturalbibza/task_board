// Патч phase9-test.mjs: call() с телом запроса (одноразовый).
import fs from 'node:fs';

const path = 'scripts/phase9-test.mjs';
let src = fs.readFileSync(path, 'utf8');

const callOld = `function call(cookie, method, path) {
  return fetch(\`\${BASE}\${path}\`, { method, headers: { Cookie: cookie ?? '' } }).then(async (res) => ({
    status: res.status,
    data: await res.json().catch(() => null),
  }));
}`;
if (!src.includes(callOld)) {
  console.error('CALL ANCHOR NOT FOUND');
  process.exit(1);
}
const callNew = `function call(cookie, method, path, body) {
  return fetch(\`\${BASE}\${path}\`, {
    method,
    headers: { Cookie: cookie ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => ({
    status: res.status,
    data: await res.json().catch(() => null),
  }));
}`;
src = src.replace(callOld, callNew);

const createOld = "await call(a.cookie, 'POST', '/boards', undefined)";
if (!src.includes(createOld)) {
  console.error('CREATE ANCHOR NOT FOUND');
  process.exit(1);
}
src = src.replace(createOld, "await call(a.cookie, 'POST', '/boards', { title: 'Фаза 9' })");

fs.writeFileSync(path, src);
console.log('patched');
