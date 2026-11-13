// Патч: export joinRouter + чистка импорта phase9-test (одноразовый).
import fs from 'node:fs';

let invites = fs.readFileSync('packages/server/src/http/invites.ts', 'utf8');
const jAnchor = 'const joinRouter = Router();';
if (!invites.includes(jAnchor)) {
  console.error('JOIN ANCHOR NOT FOUND');
  process.exit(1);
}
invites = invites.replace(jAnchor, 'export const joinRouter = Router();');
fs.writeFileSync('packages/server/src/http/invites.ts', invites);

let test = fs.readFileSync('scripts/phase9-test.mjs', 'utf8');
const tAnchor = "import { execSync } from 'node:child_process';\n";
if (!test.includes(tAnchor)) {
  console.log('test: импорта execSync нет — ок');
} else {
  test = test.replace(tAnchor, '');
  fs.writeFileSync('scripts/phase9-test.mjs', test);
}
console.log('patched');
