# Task Board

Коллаборативная доска задач (типа Trello): drag-n-drop, обновления в реальном времени
через WebSockets, шаринг досок по invite-ссылкам.

**Прод: https://bibza.ru** (Docker Compose на VPS, TLS через Caddy)

## Стек

TypeScript (strict) · pnpm workspaces · React + Vite · @dnd-kit · Node.js + Express +
Socket.IO · PostgreSQL + Drizzle · zod · Docker Compose · GitHub Actions (CI/CD)

## Документация (Spec-Driven)

- [`AGENTS.md`](AGENTS.md) — постоянные инструкции для агентов (OpenCode читает автоматически)
- [`specs/constitution.md`](specs/constitution.md) — принципы разработки
- [`specs/001-task-board/spec.md`](specs/001-task-board/spec.md) — требования и критерии приёмки
- [`specs/001-task-board/plan.md`](specs/001-task-board/plan.md) — архитектура, модель данных, WS-протокол
- [`specs/001-task-board/tasks.md`](specs/001-task-board/tasks.md) — фазы работ и чекпоинты

## Запуск с нуля

Требования: Node.js ≥ 20 (вместе с npm), Git. Подключение к БД и Docker не нужны.

```bash
git clone https://github.com/naturalbibza/task_board.git
cd task_board
npm i -g pnpm             # менеджер пакетов (один раз)
pnpm install              # зависимости + бинарники встроенного PostgreSQL (~60 МБ, один раз)
pnpm dev                  # сервер (3001) + клиент (5174/5173)
```

Дальше откройте адрес клиента из вывода `pnpm dev` и зарегистрируйтесь.
`.env` и Docker не нужны: без `DATABASE_URL` сервер сам поднимает встроенный
PostgreSQL (порт 54329, данные в `packages/server/.localdb/`, в git не попадают),
JWT-секрет генерируется автоматически. Интернет после `pnpm install` не требуется.

Полезные скрипты: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm deploy:vps`.

## Выбор базы данных

Задаётся переменной `USE_EXTERNAL_DB` в `packages/server/.env` (его нет — ничего не надо):

| `USE_EXTERNAL_DB` | База | Когда удобно |
|---|---|---|
| не задана | авто: есть `DATABASE_URL` → внешняя, нет → встроенная | по умолчанию |
| `0` | встроенный PostgreSQL (порт 54329, данные `.localdb/`) | ноутбук без Docker/сети; БД остановлена |
| `1` | внешняя: обязательны `DATABASE_URL` и `JWT_SECRET` | Docker-база или прод; при отсутствии секретов — понятная ошибка при старте |

Пример внешней БД: локальный контейнер `postgres:16` на порту 5433 —
скопируйте `.env.example` в `packages/server/.env`, заполните и укажите `USE_EXTERNAL_DB=1`.

Полный стек одним контейнером (если есть Docker): `docker compose up -d` — как на проде.

## Деплой

Автоматический: пуш в `main` → GitHub Actions (проверки → деплой на VPS → health-check).

Ручной запасной путь: `pnpm deploy:vps` (параметризуется: `-Target user@host`,
`-Key путь\к\ключу` или env `TASKBOARD_DEPLOY_TARGET` / `TASKBOARD_DEPLOY_KEY`).
Секреты прода хранятся только на сервере (`.env` + мастер-копия вне каталога деплоя).

Статус: ✅ фазы 0–5 (…, доски и контент) → 🚧 фаза 6 (WebSocket-канал)
