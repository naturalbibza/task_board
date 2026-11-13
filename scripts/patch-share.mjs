// Патч: кнопка «Поделиться» + ShareModal в BoardPage (одноразовый).
import fs from 'node:fs';

const path = 'packages/client/src/pages/BoardPage.tsx';
let src = fs.readFileSync(path, 'utf8');

const anchor = '        <MembersBar online={online} members={snapshot.members} />\n';
if (!src.includes(anchor)) {
  console.error('ANCHOR NOT FOUND');
  process.exit(1);
}

const insertion = `        <MembersBar online={online} members={snapshot.members} />
        {snapshot.board.role === 'OWNER' && (
          <button type="button" onClick={() => setShareOpen(true)}>
            Поделиться
          </button>
        )}
        {shareOpen && (
          <ShareModal boardId={snapshot.board.id} members={snapshot.members} onClose={() => setShareOpen(false)} />
        )}
`;

if (src.includes('setShareOpen')) {
  console.log('уже пропатчено');
  process.exit(0);
}
src = src.replace(anchor, insertion);

// state для модалки
const stateAnchor = '  const [error, setError] = useState<string | null>(null);\n';
if (!src.includes(stateAnchor)) {
  console.error('STATE ANCHOR NOT FOUND');
  process.exit(1);
}
src = src.replace(
  stateAnchor,
  stateAnchor + '  const [shareOpen, setShareOpen] = useState(false);\n',
);

// импорт модалки
const importAnchor = "import { MembersBar } from '../components/MembersBar';\n";
if (!src.includes(importAnchor)) {
  console.error('IMPORT ANCHOR NOT FOUND');
  process.exit(1);
}
src = src.replace(importAnchor, importAnchor + "import { ShareModal } from '../components/ShareModal';\n");

fs.writeFileSync(path, src);
console.log('patched');
