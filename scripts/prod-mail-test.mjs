// Прод-проверка фазы 14: регистрация, письмо подтверждения, ограничения FR-32.
// Запуск: node scripts/prod-mail-test.mjs [email]
const BASE = 'https://bibza.ru';
const API = `${BASE}/api`;
const email = process.argv[2] ?? `noreply-localplace+tb${Date.now()}@yandex.ru`;

const results = [];
const check = (name, cond, extra = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) process.exitCode = 1;
};

const res = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'password123', name: 'Проверка почты' }),
});
const cookie = res.headers.get('set-cookie')?.split(';')[0];
const body = await res.json();
check('регистрация на проде', res.status === 201, `status=${res.status}`);
check('emailVerified=false у нового аккаунта', body.user?.emailVerified === false);

const board = await fetch(`${API}/boards`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ title: 'Нельзя до подтверждения' }),
});
const boardBody = await board.json();
check('создание доски до подтверждения → 403 EMAIL_NOT_VERIFIED', board.status === 403 && boardBody.error?.code === 'EMAIL_NOT_VERIFIED', boardBody.error?.code ?? '');

const resend = await fetch(`${API}/auth/resend-verification`, { method: 'POST', headers: { Cookie: cookie } });
const resendBody = await resend.json();
check('повторная отправка сразу → 429 RATE_LIMITED', resend.status === 429 && resendBody.error?.code === 'RATE_LIMITED', resendBody.error?.code ?? '');

const me = await fetch(`${API}/auth/me`, { headers: { Cookie: cookie } }).then((r) => r.json());
check('профиль: email тот же', me.user?.email === email);

console.log(results.join('\n'));
console.log(`\nПисьмо отправлено на: ${email}`);
console.log(`Итого: ${results.filter((r) => r.startsWith('✅')).length}/${results.length}`);
