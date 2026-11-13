// E2E фазы 8 (A1/A2): два пользователя, WS-мутации, латентность ≤ 1 с.
// Запуск: pnpm --filter @task-board/client exec node ../../scripts/phase8-test.mjs
import { execSync } from 'node:child_process';
import { io } from 'socket.io-client';

const BASE = 'http://localhost:3001/api';
const WS = 'http://localhost:3001';

const results = [];
const check = (name, cond) => {
  results.push(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) process.exitCode = 1;
};

async function register(email) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return { cookie, userId: (await res.json()).user.id };
}

function connect(cookie) {
  return io(WS, { extraHeaders: { Cookie: cookie } });
}

function waitEvent(socket, event, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve({ payload, latency: Date.now() - started });
    });
  });
}

const a = await register(`p8a-${Date.now()}@test.dev`);
const b = await register(`p8b-${Date.now()}@test.dev`);

// A создаёт доску по REST (CRUD досок — REST по FR-8)
const boardRes = await fetch(`${BASE}/boards`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
  body: JSON.stringify({ title: 'Фаза 8' }),
});
const boardId = (await boardRes.json()).board.id;

// B пока не участник — добавляем напрямую в БД (шаринг — фаза 9)
execSync(
  `docker exec task-board-db psql -U postgres -d task_board -c "INSERT INTO board_members (\\"boardId\\", \\"userId\\", role) VALUES ('${boardId}', '${b.userId}', 'MEMBER')"`,
);

const sockA = connect(a.cookie);
const sockB = connect(b.cookie);
await Promise.all([new Promise((r) => sockA.once('connect', r)), new Promise((r) => sockB.once('connect', r))]);

// оба в комнате
const stateA = waitEvent(sockA, 'board:state');
sockA.emit('board:join', { boardId });
const snap = (await stateA)?.payload;
check('A: снапшот получен', snap?.board?.id === boardId);
const stateB = waitEvent(sockB, 'board:state');
sockB.emit('board:join', { boardId });
check('B: снапшот получен', (await stateB)?.payload?.board?.id === boardId);

// A создаёт колонку → B получает column:created (латентность ≤ 1 с)
const colCreated = waitEvent(sockB, 'column:created');
sockA.emit('column:create', { boardId, title: 'Колонка B видит' });
const colRes = await colCreated;
check('column:created у B ≤ 1 с', colRes !== null && colRes.latency <= 1000);
const columnId = colRes?.payload?.column?.id;

// A создаёт карточку → B получает card:created
const cardCreated = waitEvent(sockB, 'card:created');
sockA.emit('card:create', { columnId, title: 'Карточка от A' });
const cardRes = await cardCreated;
check('card:created у B ≤ 1 с', cardRes !== null && cardRes.latency <= 1000);
const cardId = cardRes?.payload?.card?.id;

// A двигает карточку → B получает card:moved ≤ 1 с (A1)
const cardMoved = waitEvent(sockB, 'card:moved');
sockA.emit('card:move', { id: cardId, toColumnId: columnId, beforeId: null, afterId: null });
const moveRes = await cardMoved;
check('A1: card:moved у B ≤ 1 с', moveRes !== null && moveRes.latency <= 1000);

// A редактирует → B получает card:updated
const cardUpdated = waitEvent(sockB, 'card:updated');
sockA.emit('card:update', { id: cardId, title: 'Новое название', description: 'описание' });
const updRes = await cardUpdated;
check('card:updated у B ≤ 1 с', updRes !== null && updRes.latency <= 1000);

// A начинает редактирование → B получает presence:editing
const editing = waitEvent(sockB, 'presence:editing');
sockA.emit('card:editing-start', { cardId });
const editRes = await editing;
check('presence:editing у B', editRes?.payload?.userId === a.userId);

// A удаляет колонку → B получает column:deleted
const colDeleted = waitEvent(sockB, 'column:deleted');
sockA.emit('column:delete', { id: columnId });
const delRes = await colDeleted;
check('column:deleted у B ≤ 1 с', delRes !== null && delRes.latency <= 1000);

sockA.disconnect();
sockB.disconnect();
console.log(results.join('\n'));
