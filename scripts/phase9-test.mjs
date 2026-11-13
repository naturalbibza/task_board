// E2E фазы 9 (A3/A4): invite-ссылки — создание, вступление, отзыв, неавторизованный 401.
// Запуск: pnpm --filter @task-board/client exec node ../../scripts/phase9-test.mjs

const BASE = 'http://localhost:3001/api';

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

function call(cookie, method, path, body) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookie ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => ({
    status: res.status,
    data: await res.json().catch(() => null),
  }));
}

const a = await register(`p9a-${Date.now()}@test.dev`);
const b = await register(`p9b-${Date.now()}@test.dev`);

// A создаёт доску и инвайт
const board = await call(a.cookie, 'POST', '/boards', { title: 'Фаза 9' });
check('доска создана', board.status === 201);
const boardId = board.data.board.id;

// не-владелец не может управлять инвайтами (US-10)
const forbidden = await call(b.cookie, 'POST', `/boards/${boardId}/invites`);
check('B не может создать инвайт → 404/403', forbidden.status === 404 || forbidden.status === 403);

// A создаёт ссылку
const invite = await call(a.cookie, 'POST', `/boards/${boardId}/invites`);
check('инвайт создан', invite.status === 201);
const token = invite.data.invite.token;
check('токен ≥ 32 символов (FR-16)', token.length >= 32);

// неавторизованный по ссылке → 401 (A3, первый шаг)
const anon = await call(null, 'GET', `/join/${token}`);
check('неавторизованный → 401 (redirect на логин)', anon.status === 401);

// B вступает по ссылке (A3)
const join = await call(b.cookie, 'GET', `/join/${token}`);
check('B вступил по ссылке → 200', join.status === 200 && join.data.boardId === boardId);

// повторное вступление — идемпотентно
const join2 = await call(b.cookie, 'GET', `/join/${token}`);
check('повторный join → 200 (не дублируется)', join2.status === 200);

// B теперь участник: видит доску в списке
const boardsB = await call(b.cookie, 'GET', '/boards');
check('доска появилась у B', boardsB.data.boards.some((x) => x.id === boardId));

// A отзывает ссылку (A4)
const revoke = await call(a.cookie, 'PATCH', `/invites/${invite.data.invite.id}`);
check('инвайт отозван', revoke.status === 200 && revoke.data.invite.revoked === true);

// новый пользователь по отозванной ссылке → отказ (A4)
const c = await register(`p9c-${Date.now()}@test.dev`);
const joinRevoked = await call(c.cookie, 'GET', `/join/${token}`);
check('A4: отозванная ссылка → 403', joinRevoked.status === 403 && joinRevoked.data.error.code === 'INVITE_INVALID');

console.log(results.join('\n'));
