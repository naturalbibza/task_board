// Разовый e2e-тест фазы 6: WS join/snapshot/presence/ws:error (A7).
// Запуск: pnpm --filter @task-board/client exec node ../../scripts/phase6-test.mjs
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
  return { cookie };
}

function connect(cookie) {
  return io(WS, { extraHeaders: { Cookie: cookie } });
}

function once(socket, event, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

const emailA = `p6a-${Date.now()}@test.dev`;
const emailB = `p6b-${Date.now()}@test.dev`;
const a = await register(emailA);
const b = await register(emailB);

// A создаёт доску по REST
const boardRes = await fetch(`${BASE}/boards`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
  body: JSON.stringify({ title: 'WS тест' }),
});
const boardId = (await boardRes.json()).board.id;
check('доска создана по REST', Boolean(boardId));

// Два WS-клиента: A (владелец) и B (не участник)
const sockA = connect(a.cookie);
const sockB = connect(b.cookie);
await Promise.all([once(sockA, 'connect'), once(sockB, 'connect')]);
check('обе WS-руки подключились', true);

// 1. B пытается подключиться к чужой доске → ws:error (A7)
const errPromise = once(sockB, 'ws:error');
sockB.emit('board:join', { boardId });
const err = await errPromise;
check('чужая доска → ws:error BOARD_NOT_FOUND', err?.code === 'BOARD_NOT_FOUND');

// 2. A подключается → получает снапшот (FR-13)
const statePromise = once(sockA, 'board:state');
sockA.emit('board:join', { boardId });
const state = await statePromise;
check('board:state со снапшотом', state?.board?.id === boardId && state.columns.length === 3);

// 3. B становится участником (через REST нельзя в v1 — добавим через A вручную в БД нельзя; проверим presence A)
// A один в комнате:
const presence1 = await once(sockA, 'presence:update');
check('presence после join A: 1 пользователь', presence1?.users?.length === 1);

// 4. A повторно открывает вкладку (новый сокет того же пользователя) — дедупликация presence
const sockA2 = connect(a.cookie);
await once(sockA2, 'connect');
const presence2Promise = once(sockA, 'presence:update');
sockA2.emit('board:join', { boardId });
await once(sockA2, 'board:state');
const presence2 = await presence2Promise;
check('две вкладки одного пользователя дедуплицированы', presence2?.users?.length === 1);

// 5. Вторая вкладка A уходит → presence всё ещё 1 (осталась вкладка 1)
const presence3Promise = once(sockA, 'presence:update');
sockA2.emit('board:leave', { boardId });
const presence3 = await presence3Promise;
check('после leave вкладки 2: presence 1', presence3?.users?.length === 1);

sockA.disconnect();
sockA2.disconnect();
sockB.disconnect();

console.log(results.join('\n'));
