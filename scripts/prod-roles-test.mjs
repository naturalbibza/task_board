// Прод-проверка ролей v2 (фаза 12): права VIEWER, смена роли, отзыв ссылки.
// Запуск: node scripts/prod-roles-test.mjs [BASE_URL]
import { io } from 'socket.io-client';

const BASE = process.argv[2] ?? 'https://bibza.ru';
const API = `${BASE}/api`;

const results = [];
const check = (name, cond, extra = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) process.exitCode = 1;
};

async function register(email) {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return res.headers.get('set-cookie')?.split(';')[0];
}

const connect = (cookie) => io(BASE, { extraHeaders: { Cookie: cookie }, reconnection: false });
const once = (socket, event, timeoutMs = 5000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const stamp = Date.now();
const cookieA = await register(`roles-a-${stamp}@test.dev`);
const cookieB = await register(`roles-b-${stamp}@test.dev`);

const board = await fetch(`${API}/boards`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  body: JSON.stringify({ title: 'Прод роли' }),
}).then((r) => r.json());
const boardId = board.board.id;

const invite = await fetch(`${API}/boards/${boardId}/invites`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  body: JSON.stringify({ role: 'VIEWER' }),
}).then((r) => r.json());
check('инвайт с ролью VIEWER создан', invite.invite?.role === 'VIEWER');

const join = await fetch(`${API}/join/${invite.invite.token}`, { headers: { Cookie: cookieB } });
check('B вступил по ссылке', join.status === 200);

const members = await fetch(`${API}/boards/${boardId}/members`, { headers: { Cookie: cookieA } }).then((r) => r.json());
const bMember = members.members.find((m) => m.role === 'VIEWER');
check('B в списке участников с ролью наблюдателя', Boolean(bMember));

// B (VIEWER) не может создавать контент — сервер отклоняет
const sockB = connect(cookieB);
await once(sockB, 'connect');
const stateB = once(sockB, 'board:state');
sockB.emit('board:join', { boardId });
const snapB = await stateB;
check('B получил снапшот, роль в DTO', snapB?.board?.role === 'VIEWER', snapB?.board?.role ?? 'нет');

const forbidden = once(sockB, 'ws:error');
sockB.emit('column:create', { boardId, title: 'Нельзя' });
const err = await forbidden;
check('VIEWER: мутация отклонена FORBIDDEN', err?.code === 'FORBIDDEN', err?.code ?? 'нет ошибки');

const columnsAfter = await fetch(`${API}/boards/${boardId}`, { headers: { Cookie: cookieA } }).then((r) => r.json());
check('VIEWER: колонка не создана', columnsAfter.columns.length === 3);

// A повышает B до редактора — B может создавать контент
const patch = await fetch(`${API}/boards/${boardId}/members/${bMember.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  body: JSON.stringify({ role: 'EDITOR' }),
});
check('владелец повысил B до редактора', patch.status === 200);

const created = once(sockB, 'column:created');
sockB.emit('column:create', { boardId, title: 'От редактора' });
const col = await created;
check('EDITOR: мутация разрешена', Boolean(col?.column?.id));

// A удаляет B — ссылка отзывается, вернуться нельзя
const removed = await fetch(`${API}/boards/${boardId}/members/${bMember.id}`, {
  method: 'DELETE',
  headers: { Cookie: cookieA },
}).then((r) => r.json());
check('B удалён, ссылка отозвана', removed.ok === true && removed.revokedInvites >= 1, `revoked=${removed.revokedInvites}`);

await new Promise((r) => setTimeout(r, 300));
const rejoined = await fetch(`${API}/join/${invite.invite.token}`, { headers: { Cookie: cookieB } });
check('повторный вход по той же ссылке запрещён', rejoined.status === 403);

const boardsB = await fetch(`${API}/boards`, { headers: { Cookie: cookieB } }).then((r) => r.json());
check('удалённый участник не видит доску', !boardsB.boards.some((b) => b.id === boardId));

// VIEWER не может менять роли (проверяем на примере C)
const cookieC = await register(`roles-c-${stamp}@test.dev`);
const inviteViewer = await fetch(`${API}/boards/${boardId}/invites`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  body: JSON.stringify({ role: 'VIEWER' }),
}).then((r) => r.json());
await fetch(`${API}/join/${inviteViewer.invite.token}`, { headers: { Cookie: cookieC } });
const membersC = await fetch(`${API}/boards/${boardId}/members`, { headers: { Cookie: cookieA } }).then((r) => r.json());
const cMember = membersC.members.find((m) => m.role === 'VIEWER');
const forbiddenPatch = await fetch(`${API}/boards/${boardId}/members/${cMember.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Cookie: cookieC },
  body: JSON.stringify({ role: 'EDITOR' }),
});
check('VIEWER не может менять роли (403)', forbiddenPatch.status === 403);

sockB.disconnect();
console.log(results.join('\n'));
console.log(`\nИтого: ${results.filter((r) => r.startsWith('✅')).length}/${results.length}`);
