// Разовый e2e-тест фазы 5 (HTTP): доски/колонки/карточки + изоляция пользователей.
const BASE = 'http://localhost:3001/api';

async function register(email, password) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`register ${email}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return { cookie, user: (await res.json()).user };
}

function call(cookie, method, path, body) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => null) }));
}

const results = [];
const check = (name, cond) => {
  results.push(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) process.exitCode = 1;
};

const emailA = `p5a-${Date.now()}@test.dev`;
const emailB = `p5b-${Date.now()}@test.dev`;

const a = await register(emailA, 'password123');
const b = await register(emailB, 'password123');

// 1. Создание доски с колонками по умолчанию (FR-4)
let r = await call(a.cookie, 'POST', '/boards', { title: 'Фаза 5 тест' });
check('POST /boards → 201', r.status === 201);
if (!r.data) {
  console.log('POST /boards ответ:', r.status, JSON.stringify(r.data));
  process.exit(1);
}
check('роль владельца', r.data.board.role === 'OWNER');
const boardId = r.data.board.id;

r = await call(a.cookie, 'GET', `/boards/${boardId}`);
check('3 колонки по умолчанию', r.data.columns.length === 3);
check('колонка To Do первая', r.data.columns[0].title === 'To Do');
check('участники: 1', r.data.members.length === 1);

// 2. Колонка и карточка
r = await call(a.cookie, 'POST', `/boards/${boardId}/columns`, { title: 'Тест колонка' });
check('POST column → 201', r.status === 201);
const columnId = r.data.column.column ?? r.data.column.id;
const colId = r.data.column.id;

r = await call(a.cookie, 'POST', `/columns/${colId}/cards`, { title: 'Тест карточка', description: 'описание' });
check('POST card → 201', r.status === 201);
const cardId = r.data.card.id;

// 3. Переименование колонки и карточки
r = await call(a.cookie, 'PATCH', `/columns/${colId}`, { title: 'Переименованная' });
check('PATCH column', r.status === 200 && r.data.column.title === 'Переименованная');
r = await call(a.cookie, 'PATCH', `/cards/${cardId}`, { title: 'Новый заголовок', description: 'новое описание' });
check('PATCH card', r.status === 200 && r.data.card.title === 'Новый заголовок');

// 4. Персистентность (аналог F5 — новый запрос)
r = await call(a.cookie, 'GET', `/boards/${boardId}`);
check('после F5: колонка на месте', r.data.columns.some((c) => c.title === 'Переименованная'));
check(
  'после F5: карточка с описанием',
  r.data.cards.some((c) => c.id === cardId && c.description === 'новое описание'),
);

// 5. Изоляция: пользователь B не видит доску A
r = await call(b.cookie, 'GET', `/boards/${boardId}`);
check('чужая доска → 404', r.status === 404);
r = await call(b.cookie, 'PATCH', `/columns/${colId}`, { title: 'взлом' });
check('чужая колонка → 404', r.status === 404);

// 6. B не может удалить доску A; A может
r = await call(b.cookie, 'DELETE', `/boards/${boardId}`);
check('чужой DELETE → 404 (B не участник)', r.status === 404);

console.log(results.join('\n'));
