// Прод-проверка фаз 8–9: invite-вступление + реал-тайм мутации через WSS.
// Запуск: node scripts/prod-phase89-test.mjs [BASE_URL]
import { io } from 'socket.io-client';

const BASE = process.argv[2] ?? 'https://bibza.ru';
const API = `${BASE}/api`;

const results = [];
const check = (name, cond) => {
  results.push(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) process.exitCode = 1;
};

async function register(email) {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}

const cookieA = await register(`prod8a-${Date.now()}@test.dev`);
const cookieB = await register(`prod8b-${Date.now()}@test.dev`);

// A: доска + инвайт; B вступает по ссылке (фаза 9)
const boardRes = await fetch(`${API}/boards`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  body: JSON.stringify({ title: 'Прод 8-9' }),
});
const boardId = (await boardRes.json()).board.id;

const inviteRes = await fetch(`${API}/boards/${boardId}/invites`, {
  method: 'POST',
  headers: { Cookie: cookieA },
});
const token = (await inviteRes.json()).invite.token;
check('инвайт создан на проде', Boolean(token));

const join = await fetch(`${API}/join/${token}`, { headers: { Cookie: cookieB } });
check('B вступил по ссылке', join.status === 200);

// WS: оба в комнате, A двигает карточку → B получает card:moved ≤ 1 с (A1)
function connect(cookie) {
  return io(BASE, { extraHeaders: { Cookie: cookie } });
}
function waitEvent(socket, event, timeoutMs = 4000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve({ payload, latency: Date.now() - started });
    });
  });
}

const sockA = connect(cookieA);
const sockB = connect(cookieB);
await Promise.all([new Promise((r) => sockA.once('connect', r)), new Promise((r) => sockB.once('connect', r))]);

const stateA = waitEvent(sockA, 'board:state');
sockA.emit('board:join', { boardId });
const snap = (await stateA)?.payload;
check('A: снапшот по WSS', snap?.board?.id === boardId);
const stateB = waitEvent(sockB, 'board:state');
sockB.emit('board:join', { boardId });
await stateB;

// A создаёт колонку и карточку (WS-мутации, фаза 8)
const colEvent = waitEvent(sockA, 'column:created');
sockA.emit('column:create', { boardId, title: 'Прод колонка' });
const columnId = (await colEvent)?.payload?.column?.id;
check('column:created на проде', Boolean(columnId));

const cardEvent = waitEvent(sockA, 'card:created');
sockA.emit('card:create', { columnId, title: 'Прод карточка' });
const cardId = (await cardEvent)?.payload?.card?.id;
check('card:created на проде', Boolean(cardId));

// A двигает карточку → B видит карточку в новой колонке (A1: ≤ 1 с)
const snapshot = await (await fetch(`${API}/boards/${boardId}`, { headers: { Cookie: cookieA } })).json();
const targetColumn = snapshot.columns.find((c) => c.id !== columnId);
const moveEvent = waitEvent(sockB, 'card:moved');
sockA.emit('card:move', { id: cardId, toColumnId: targetColumn.id, beforeId: null, afterId: null });
const moveRes = await moveEvent;
check('A1 на проде: card:moved у B ≤ 1 с', moveRes !== null && moveRes.latency <= 1000);

const after = await (await fetch(`${API}/boards/${boardId}`, { headers: { Cookie: cookieB } })).json();
const moved = after.cards.find((c) => c.id === cardId);
check('перемещение сохранено в БД', moved?.columnId === targetColumn.id);

sockA.disconnect();
sockB.disconnect();
console.log(results.join('\n'));
