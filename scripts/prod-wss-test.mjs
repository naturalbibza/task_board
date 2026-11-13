// Проверка WSS на проде: register → REST-доска → socket.io join → state + presence → ws:error.
// Запуск: node scripts/prod-wss-test.mjs [BASE_URL]
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
  if (!res.ok) throw new Error(`register: ${res.status} ${await res.text()}`);
  return res.headers.get('set-cookie').split(';')[0];
}

const email = `wss-${Date.now()}@test.dev`;
const cookie = await register(email);
check('register на проде', Boolean(cookie));

const boardRes = await fetch(`${API}/boards`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ title: 'WSS прод-тест' }),
});
const boardId = (await boardRes.json()).board.id;
check('доска создана', Boolean(boardId));

const socket = io(BASE, { extraHeaders: { Cookie: cookie } });
await Promise.race([
  new Promise((resolve) => socket.once('connect', resolve)),
  new Promise((_, rej) => setTimeout(() => rej(new Error('WS connect timeout')), 10000)),
]);
check('WS(S) подключился к прод', true);

// Слушатели регистрируются ДО эмита — события приходят подряд, гонки быть не должно
const statePromise = Promise.race([
  new Promise((resolve) => socket.once('board:state', resolve)),
  new Promise((_, rej) => setTimeout(() => rej(new Error('board:state timeout')), 10000)),
]);
const presencePromise = Promise.race([
  new Promise((resolve) => socket.once('presence:update', resolve)),
  new Promise((_, rej) => setTimeout(() => rej(new Error('presence timeout')), 10000)),
]);
socket.emit('board:join', { boardId });

const state = await statePromise;
check('board:state по WSS (3 колонки)', state?.board?.id === boardId && state.columns.length === 3);

const presence = await presencePromise;
check('presence по WSS (1 пользователь)', presence?.users?.length === 1);

const err = await Promise.race([
  new Promise((resolve) => {
    socket.once('ws:error', resolve);
    socket.emit('board:join', { boardId: 'nonexistent-board' });
  }),
  new Promise((_, rej) => setTimeout(() => rej(new Error('ws:error timeout')), 10000)),
]);
check('чужая/несуществующая доска → ws:error', err?.code === 'BOARD_NOT_FOUND');

socket.disconnect();
console.log(results.join('\n'));
