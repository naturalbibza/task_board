// Проверка NFR-4: 1000 вставок в середину колонки через WS card:move.
// Запуск: pnpm --filter @task-board/client exec node ../../scripts/phase7-test.mjs [N]
import { io } from 'socket.io-client';
import { spawn } from 'node:child_process';

const N = Number(process.argv[2] ?? 1000);
const BASE = 'http://localhost:3001/api';
const WS = 'http://localhost:3001';

// Сервер живёт внутри теста, чтобы фоновые шеллы не прибивались средой
let serverChild = null;
try {
  await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
  console.log('сервер уже запущен — используем');
} catch {
  console.log('поднимаю сервер...');
  serverChild = spawn('pnpm', ['--filter', '@task-board/server', 'start'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
  });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      up = true;
    } catch {}
  }
  if (!up) throw new Error('сервер не поднялся');
}

async function register(email) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}

const cookie = await register(`p7-${Date.now()}@test.dev`);

const created = await fetch(`${BASE}/boards`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ title: 'NFR-4' }),
});
const boardId = (await created.json()).board.id;

// снапшот: id колонок по умолчанию
const snap = await (await fetch(`${BASE}/boards/${boardId}`, { headers: { Cookie: cookie } })).json();
const todo = snap.columns.find((c) => c.title === 'To Do');
const progress = snap.columns.find((c) => c.title === 'In Progress');

// якорь в In Progress + перемещаемая карточка в To Do
async function createCard(columnId, title) {
  const res = await fetch(`${BASE}/columns/${columnId}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title }),
  });
  return (await res.json()).card.id;
}
const anchorId = await createCard(progress.id, 'anchor');
const movingIds = [];
for (let i = 0; i < N; i++) movingIds.push(await createCard(todo.id, `card-${i}`));
console.log(`создано карточек: ${N + 1}`);

const socket = io(WS, { extraHeaders: { Cookie: cookie } });
await Promise.race([
  new Promise((resolve) => socket.once('connect', resolve)),
  new Promise((_, rej) => setTimeout(() => rej(new Error('WS connect timeout')), 10000)),
]);

let received = 0;
let wsErrors = 0;
let lastReceived = 0;
let idleSeconds = 0;
socket.on('card:moved', () => received++);
socket.on('ws:error', () => wsErrors++);
socket.emit('board:join', { boardId });
await Promise.race([
  new Promise((resolve) => socket.once('board:state', resolve)),
  new Promise((_, rej) => setTimeout(() => rej(new Error('board:state timeout')), 10000)),
]);

const started = Date.now();
// 1000 вставок перед якорем: каждая — в зазор (anchor, предыдущая вставка)
for (let i = 0; i < N; i++) {
  socket.emit('card:move', { id: movingIds[i], toColumnId: progress.id, beforeId: anchorId, afterId: null });
}

// ждём, пока сервер обработает всё: счётчик broadcast'ов И полный состав колонки
let cards = null;
const deadline = Date.now() + 300000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = await (await fetch(`${BASE}/boards/${boardId}`, { headers: { Cookie: cookie } })).json();
  cards = s.cards.filter((c) => c.columnId === progress.id);
  if (received >= N && cards.length >= N + 1) {
    console.log(`обработано за ${(Date.now() - started) / 1000} с`);
    break;
  }
  if (received > 0 && received === lastReceived) idleSeconds += 2;
  else idleSeconds = 0;
  lastReceived = received;
  if (idleSeconds >= 15) {
    console.log(`очередь простаивает 15 с: получено ${received}, в In Progress ${cards.length}`);
    break;
  }
  if (Date.now() % 20000 < 2100) console.log(`прогресс: ${received}/${N} broadcast'ов, карточек в IP: ${cards.length}`);
}
const elapsed = Date.now() - started;
console.log(`время: ${(elapsed / 1000).toFixed(1)} с, card:moved получено: ${received}`);

// проверки порядка (NFR-4): количество, уникальность, строгая монотонность
const sorted = [...cards].sort((a, b) => a.position - b.position);
const positions = sorted.map((c) => c.position);
const unique = new Set(positions.map((p) => p.toFixed(6))).size === positions.length;
const monotonic = positions.every((p, i) => i === 0 || p > positions[i - 1]);
const all = sorted.every((c) => Number.isFinite(c.position));

const results = [];
const check = (name, cond) => {
  results.push(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) process.exitCode = 1;
};
check(`все ${N + 1} карточек в In Progress`, cards.length === N + 1);
check('позиции уникальны', unique);
check('позиции строго возрастают', monotonic);
check('позиции конечны', all);
check(`все broadcast'ы доставлены (${received}/${N})`, received >= N);
check(`ошибок ws:error нет (${wsErrors})`, wsErrors === 0);
socket.disconnect();
if (serverChild) {
  serverChild.kill();
}
console.log(results.join('\n'));
