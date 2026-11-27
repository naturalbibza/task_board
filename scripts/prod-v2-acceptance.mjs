// Прод-приёмка v2 (V2, V7, V8 и служебные проверки). Запуск:
//   node scripts/prod-v2-acceptance.mjs
// Использует тестовый аккаунт с прода (подтверждённый email). Секреты не печатает.
const BASE = process.env.PROD_BASE ?? 'https://bibza.ru';
const API = `${BASE}/api`;
const email = process.env.PROD_EMAIL ?? 'prodtest@taskboard.dev';
const password = process.env.PROD_PASSWORD ?? 'prodpass123';

const results = [];
const check = (name, cond, extra = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) process.exitCode = 1;
};

const json = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

// 1. health и версия контракта
const healthRes = await fetch(`${API}/health`);
const health = await json(healthRes);
check('health: сервер жив', healthRes.ok && health?.status === 'ok');
check('health: apiVersion = 2.0', health?.apiVersion === '2.0', health?.apiVersion ?? 'нет');

// 2. вход тестовым подтверждённым аккаунтом
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const login = await json(loginRes);
const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
check('вход тестовым аккаунтом', loginRes.ok && Boolean(cookie), `status=${loginRes.status}`);
check('тестовый аккаунт подтверждён (V4)', login?.user?.emailVerified === true);
const auth = (init = {}) => ({ ...init, headers: { ...(init.headers ?? {}), Cookie: cookie } });

const suffix = Date.now().toString(36);
const boardTitle = `accept-${suffix}`;
let boardId;
let templateId;
let secondBoardId;
let columnTemplateId;

try {
  // 3. создание доски и колонки по умолчанию
  const createRes = await fetch(`${API}/boards`, auth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: boardTitle }),
  }));
  const created = await json(createRes);
  boardId = created?.board?.id;
  check('создание доски (V7/V8)', createRes.status === 201 && Boolean(boardId));

  const snap = await json(await fetch(`${API}/boards/${boardId}`, auth()));
  check('доска: 3 колонки по умолчанию', snap?.columns?.length === 3, `${snap?.columns?.length ?? 0}`);

  // 4. избранное (V7)
  const fav = await json(
    await fetch(`${API}/boards/${boardId}/favorite`, auth({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    })),
  );
  check('избранное сохраняется (V7)', fav?.favorite === true);

  // 5. архив/восстановление (V7)
  const arch = await json(await fetch(`${API}/boards/${boardId}/archive`, auth({ method: 'POST' })));
  check('архив: archivedAt выставлен (V7)', Boolean(arch?.board?.archivedAt));
  const archivedList = await json(await fetch(`${API}/boards?archived=1`, auth()));
  check('архив: доска во вкладке «Архив»', Boolean(archivedList?.boards?.some((b) => b.id === boardId)));
  const activeList = await json(await fetch(`${API}/boards`, auth()));
  check('архив: доска скрыта из активных', !activeList?.boards?.some((b) => b.id === boardId));

  const restored = await json(await fetch(`${API}/boards/${boardId}/restore`, auth({ method: 'POST' })));
  check('восстановление доски (V7)', restored?.board?.archivedAt === null);

  // 6. шаблоны досок (V8)
  const tmpl = await json(
    await fetch(`${API}/board-templates`, auth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId, title: `tmpl-${suffix}` }),
    })),
  );
  templateId = tmpl?.template?.id;
  check('сохранение шаблона доски (V8)', Boolean(templateId));

  const fromTmpl = await json(
    await fetch(`${API}/boards`, auth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${boardTitle}-copy`, templateId }),
    })),
  );
  secondBoardId = fromTmpl?.board?.id;
  const copied = await json(await fetch(`${API}/boards/${secondBoardId}`, auth()));
  check(
    'создание доски из шаблона: колонки скопированы (V8)',
    copied?.columns?.length === 3,
    `${copied?.columns?.length ?? 0}`,
  );

  // 7. шаблоны колонок (V8): сохранение из колонки доски
  const columnId = copied?.columns?.[0]?.id;
  const colTmpl = await json(
    await fetch(`${API}/column-templates`, auth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, title: `col-${suffix}` }),
    })),
  );
  columnTemplateId = colTmpl?.template?.id;
  check('сохранение шаблона колонки (V8)', Boolean(columnTemplateId));

  // 8. Роли (V2): приглашение с ролью VIEWER и список участников
  const inv = await json(
    await fetch(`${API}/boards/${secondBoardId}/invites`, auth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'VIEWER' }),
    })),
  );
  check('invite-ссылка с ролью (V2)', inv?.invite?.role === 'VIEWER');
  const members = await json(await fetch(`${API}/boards/${secondBoardId}/members`, auth()));
  check('участники: владелец в списке (V2)', members?.members?.some((m) => m.role === 'OWNER'));
} finally {
  // Уборка тестовых данных (не влияет на результат проверок)
  for (const id of [boardId, secondBoardId].filter(Boolean)) {
    await fetch(`${API}/boards/${id}`, auth({ method: 'DELETE' })).catch(() => undefined);
  }
  if (templateId) {
    await fetch(`${API}/board-templates/${templateId}`, auth({ method: 'DELETE' })).catch(() => undefined);
  }
  if (columnTemplateId) {
    await fetch(`${API}/column-templates/${columnTemplateId}`, auth({ method: 'DELETE' })).catch(() => undefined);
  }
}

// 9. Скрытое подтверждение email (REQUIRE_EMAIL_VERIFICATION=0, FR-52)
const hiddenEmail = `accept-hidden-${suffix}@test.dev`;
const regRes = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: hiddenEmail, password: 'password123', name: 'Acceptance hidden' }),
});
const regBody = await json(regRes);
const hiddenCookie = regRes.headers.get('set-cookie')?.split(';')[0];
check(
  'подтверждение скрыто: новый аккаунт сразу подтверждён (FR-52)',
  regRes.status === 201 && regBody?.user?.emailVerified === true,
  regBody?.user?.emailVerified === undefined ? 'нет поля' : `emailVerified=${regBody.user.emailVerified}`,
);

const hiddenBoardRes = await fetch(`${API}/boards`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: hiddenCookie },
  body: JSON.stringify({ title: `accept-hidden-${suffix}` }),
});
const hiddenBoard = await json(hiddenBoardRes);
check('подтверждение скрыто: доска создаётся без письма', hiddenBoardRes.status === 201);
if (hiddenBoard?.board?.id) {
  await fetch(`${API}/boards/${hiddenBoard.board.id}`, {
    method: 'DELETE',
    headers: { Cookie: hiddenCookie },
  }).catch(() => undefined);
}

console.log(results.join('\n'));
console.log(`\nИтого: ${results.filter((r) => r.startsWith('✅')).length}/${results.length}`);
