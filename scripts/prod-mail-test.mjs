// Прод-проверка почты и подтверждения email (фаза 14, FR-31/32/38, режим FR-52).
// Запуск: node scripts/prod-mail-test.mjs [email]
// При REQUIRE_EMAIL_VERIFICATION=1 проверяет письмо и ограничения; при 0 — скрытый режим.
const BASE = process.env.PROD_BASE ?? 'https://bibza.ru';
const API = `${BASE}/api`;
const email = process.argv[2] ?? `brizrak+tb${Date.now()}@yandex.ru`;

const results = [];
const check = (name, cond, extra = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) process.exitCode = 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json());
const required = health.emailVerificationRequired === true;
console.log(`Режим подтверждения email: ${required ? 'включён (1)' : 'скрыт (0)'}\n`);

const res = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'password123', name: 'Проверка почты' }),
});
const cookie = res.headers.get('set-cookie')?.split(';')[0];
const body = await res.json();
check('регистрация на проде', res.status === 201, `status=${res.status}`);

const me = await fetch(`${API}/auth/me`, { headers: { Cookie: cookie } }).then((r) => r.json());
check('профиль: email тот же', me.user?.email === email);

if (!required) {
  // Скрытый режим: аккаунт считается подтверждённым, доска создаётся без письма
  check('скрытый режим: emailVerified=true', body.user?.emailVerified === true);
  check('скрытый режим: флаг в health', health.emailVerificationRequired === false);

  const board = await fetch(`${API}/boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'Скрытое подтверждение' }),
  });
  const boardBody = await board.json();
  check('скрытый режим: доска создаётся сразу', board.status === 201, `status=${board.status}`);
  if (boardBody?.board?.id) {
    await fetch(`${API}/boards/${boardBody.board.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  }

  const resend = await fetch(`${API}/auth/resend-verification`, { method: 'POST', headers: { Cookie: cookie } });
  const resendBody = await resend.json();
  check('скрытый режим: resend → alreadyVerified', resendBody.alreadyVerified === true);
} else {
  // Включённый режим: письмо, ограничения FR-32 и лимит повторной отправки
  check('emailVerified=false у нового аккаунта', body.user?.emailVerified === false);

  const board = await fetch(`${API}/boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'Нельзя до подтверждения' }),
  });
  const boardBody = await board.json();
  check(
    'создание доски до подтверждения → 403 EMAIL_NOT_VERIFIED',
    board.status === 403 && boardBody.error?.code === 'EMAIL_NOT_VERIFIED',
    boardBody.error?.code ?? '',
  );

  const resend = await fetch(`${API}/auth/resend-verification`, { method: 'POST', headers: { Cookie: cookie } });
  const resendBody = await resend.json();
  check(
    'повторная отправка сразу → 429 RATE_LIMITED',
    resend.status === 429 && resendBody.error?.code === 'RATE_LIMITED',
    resendBody.error?.code ?? '',
  );
  console.log(`\nПисьмо отправлено на: ${email}`);
}

console.log(results.join('\n'));
console.log(`\nИтого: ${results.filter((r) => r.startsWith('✅')).length}/${results.length}`);
