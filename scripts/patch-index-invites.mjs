// Патч index.ts: монтирование инвайтов (одноразовый).
import fs from 'node:fs';

const path = 'packages/server/src/index.ts';
let src = fs.readFileSync(path, 'utf8');

const importOld = "import { invitesRouter, joinRouter } from './http/invites';";
if (!src.includes(importOld)) {
  console.error('IMPORT ANCHOR NOT FOUND');
  process.exit(1);
}
src = src.replace(importOld, "import { createInvite, invitesRouter, joinRouter, listInvites } from './http/invites';");

const mountOld = "app.use('/api/boards', boardsRouter);";
if (!src.includes(mountOld)) {
  console.error('MOUNT ANCHOR NOT FOUND');
  process.exit(1);
}
src = src.replace(
  mountOld,
  mountOld +
    "\nboardsRouter.get('/:id/invites', listInvites);" +
    '\nboardsRouter.post("/:id/invites", createInvite);',
);

fs.writeFileSync(path, src);
console.log('patched');
