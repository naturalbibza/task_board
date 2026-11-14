// Офлайн-синхронизация и устойчивость WS (фаза 10, п. 10.1).
// Проверяет варианты «нет сети» на уровне протокола: клиент B отключается,
// A продолжает работать, B возвращается и должен увидеть актуальное состояние.
// Запуск: node scripts/offline-sync-test.mjs [BASE_URL]
import { io } from 'socket.io-client';

const BASE = process.argv[2] ?? 'http://localhost:3001';
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
  return res.headers.get('set-cookie').split(';')[0];
}

const cookieA = await register(`off-a-${Date.now()}@test.dev`);
const cookieB = await register(`off-b-${Date.now()}@test.dev`);

const boardRes = await fetch(`${API}/boards`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieA },
  body: JSON.stringify({ title: `Офлайн ${Date.now()}` }),
});
const boardId = (await boardRes.json()).board.id;

const inviteRes = await fetch(`${API}/boards/${boardId}/invites`, { method: 'POST', headers: { Cookie: cookieA } });
const token = (await inviteRes.json()).invite.token;
const joinRes = await fetch(`${API}/join/${token}`, { headers: { Cookie: cookieB } });
check('B присоединён к доске', joinRes.status === 200);

const connect = (cookie) => io(BASE, { extraHeaders: { Cookie: cookie }, reconnection: false });

function once(socket, event, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function joinBoard(socket, timeoutMs = 5000) {
  const state = once(socket, 'board:state', timeoutMs);
  socket.emit('board:join', { boardId });
  return state;
}

async function snapshot() {
  return (await fetch(`${API}/boards/${boardId}`, { headers: { Cookie: cookieA } })).json();
}

/** Ждём, пока сервер (очередь мутаций + БД) сойдётся с ожиданием. */
async function waitFor(predicate, timeoutMs = 4000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await snapshot();
    if (predicate(last)) return { ok: true, snap: last };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok: false, snap: last };
}

const describe = (snap) =>
  snap.cards.map((c) => `${c.title}@${snap.columns.find((col) => col.id === c.columnId)?.title}`).join(', ');

const sockA = connect(cookieA);
const sockB = connect(cookieB);
await Promise.all([once(sockA, 'connect'), once(sockB, 'connect')]);
check('оба клиента подключены', sockA.connected && sockB.connected);

const snapA = await joinBoard(sockA);
await joinBoard(sockB);
const columns = snapA.columns;
check('в доске есть колонки для сценариев', columns.length >= 2, `колонок: ${columns.length}`);

// --- V1. B без сети (read-only): A перемещает карточку → B вернулся ---
sockB.disconnect();
check('V1: B действительно отключён', !sockB.connected);

const created = once(sockA, 'card:created');
sockA.emit('card:create', { columnId: columns[0].id, title: 'V1 карточка' });
const cardId = (await created)?.card?.id;
const moved = once(sockA, 'card:moved');
sockA.emit('card:move', { id: cardId, toColumnId: columns[1].id, beforeId: null, afterId: null });
await moved;

sockB.connect();
await once(sockB, 'connect');
const snapV1 = await joinBoard(sockB);
const cardV1 = snapV1?.cards?.find((c) => c.id === cardId);
check('V1: после реконнекта B видит перенос, сделанный без него', cardV1?.columnId === columns[1].id);

// --- V2. Долгий офлайн + несколько мутаций подряд ---
sockB.disconnect();
const colEvent = once(sockA, 'column:created');
sockA.emit('column:create', { boardId, title: 'V2 колонка' });
const newColumnId = (await colEvent)?.column?.id;
const card2Event = once(sockA, 'card:created');
sockA.emit('card:create', { columnId: newColumnId, title: 'V2 карточка' });
const card2Id = (await card2Event)?.card?.id;
const updEvent = once(sockA, 'card:updated');
sockA.emit('card:update', { id: card2Id, title: 'V2 карточка (изм.)' });
await updEvent;

sockB.connect();
await once(sockB, 'connect');
const snapV2 = await joinBoard(sockB);
check('V2: новая колонка появилась у B', Boolean(snapV2?.columns?.find((c) => c.id === newColumnId)));
check('V2: карточка с изменённым заголовком у B', snapV2?.cards?.find((c) => c.id === card2Id)?.title === 'V2 карточка (изм.)');

// --- V3. Одновременные мутации двух онлайн-клиентов ---
const aMove = once(sockA, 'card:moved');
const bMove = once(sockB, 'card:moved');
sockA.emit('card:move', { id: cardId, toColumnId: columns[0].id, beforeId: null, afterId: null });
sockB.emit('card:move', { id: card2Id, toColumnId: columns[1].id, beforeId: null, afterId: null });
const [resA, resB] = await Promise.all([aMove, bMove]);
check('V3: оба клиента получили событие card:moved', Boolean(resA) && Boolean(resB), `A=${Boolean(resA)} B=${Boolean(resB)}`);

const v3 = await waitFor(
  (s) =>
    s.cards.find((c) => c.id === cardId)?.columnId === columns[0].id &&
    s.cards.find((c) => c.id === card2Id)?.columnId === columns[1].id,
);
check('V3: БД консистентна (обе карточки в целевых колонках)', v3.ok, v3.ok ? '' : describe(v3.snap));

// --- V4. «Устаревшее намерение»: сосед удалён, пока B был без сети ---
// A удаляет карточку, на которую B ещё ссылается как на beforeId.
const deletedEvent = once(sockA, 'card:deleted');
sockA.emit('card:delete', { id: cardId });
await deletedEvent;

const staleMove = once(sockA, 'card:moved');
const staleError = once(sockB, 'ws:error', 1500);
sockB.emit('card:move', { id: card2Id, toColumnId: columns[0].id, beforeId: cardId, afterId: null });
const [staleRes, errRes] = await Promise.all([staleMove, staleError]);
check('V4: устаревший beforeId не ломает сервер', Boolean(staleRes));
check('V4: ошибки клиенту не отправлено', errRes === null);

const v4 = await waitFor((s) => s.cards.find((c) => c.id === card2Id)?.columnId === columns[0].id);
const afterV4 = v4.snap;
check('V4: карточка в целевой колонке', v4.ok, v4.ok ? '' : describe(afterV4));
const v4ColumnCards = afterV4.cards.filter((c) => c.columnId === columns[0].id).sort((a, b) => a.position - b.position);
check(
  'V4: порядок в колонке непротиворечив (позиции возрастают)',
  v4ColumnCards.every((c, i) => i === 0 || c.position > v4ColumnCards[i - 1].position),
);

// --- V5. Невалидная мутация: отклонена, состояние не испорчено (A7) ---
const beforeInvalid = await snapshot();
const invalidError = once(sockA, 'ws:error', 3000);
sockA.emit('card:move', { id: card2Id, toColumnId: '00000000-0000-0000-0000-000000000000', beforeId: null, afterId: null });
const invErr = await invalidError;
check('A7: невалидный card:move отклонён с ws:error', Boolean(invErr?.code), invErr?.code ?? 'нет ответа');
const afterInvalid = await snapshot();
const invalidCard = afterInvalid.cards.find((c) => c.id === card2Id);
check('A7: состояние карточки не изменилось', invalidCard?.columnId === beforeInvalid.cards.find((c) => c.id === card2Id)?.columnId);

// --- A2. Третий участник в середине сессии видит актуальное состояние ---
const cookieC = await register(`off-c-${Date.now()}@test.dev`);
const joinC = await fetch(`${API}/join/${token}`, { headers: { Cookie: cookieC } });
const sockC = connect(cookieC);
await once(sockC, 'connect');
const snapC = await joinBoard(sockC);
const current = await snapshot();
check('A2: третий участник вступил по ссылке', joinC.status === 200);
check(
  'A2: его снапшот совпадает с актуальным состоянием',
  snapC?.cards?.length === current.cards.length && snapC?.columns?.length === current.columns.length,
  `C=${snapC?.cards?.length ?? '?'}/${snapC?.columns?.length ?? '?'} vs ${current.cards.length}/${current.columns.length}`,
);
sockC.disconnect();

// --- V6. Повторный board:join (реконнект + ручной join) идемпотентен ---
const join1 = await joinBoard(sockB);
const join2 = await joinBoard(sockB);
check('V6: повторный join отдаёт актуальный снапшот', join2?.board?.id === boardId && Array.isArray(join1?.cards));

sockA.disconnect();
sockB.disconnect();
console.log(results.join('\n'));
console.log(`\nИтого: ${results.filter((r) => r.startsWith('✅')).length}/${results.length}`);