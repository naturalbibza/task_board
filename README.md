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

## Запуск (локально)

```bash
pnpm install
pnpm dev                  # без .env — сервер сам поднимет встроенный PostgreSQL (порт 54329)
```

Ничего устанавливать и настраивать больше не нужно: без `DATABASE_URL` и `JWT_SECRET`
сервер работает в автономном режиме (данные — в `packages/server/.localdb/`, в git не попадают).
Бинарники встроенного PostgreSQL скачиваются один раз при `pnpm install`.

Режим выбирается переменной `DB_MODE` в `packages/server/.env`:
- не задана — авто (есть `DATABASE_URL` → внешняя БД, нет → офлайн);
- `embedded` — всегда офлайн (удобно, когда Docker-база остановлена, а `.env` заполнен);
- `external` — всегда внешняя БД.

С внешней БД: скопируйте `.env.example` в `packages/server/.env` и заполните
`DATABASE_URL`/`JWT_SECRET` (например, на локальный контейнер Postgres на порту 5433).

Полный стек одним контейнером (если есть Docker): `docker compose up -d` — как на проде.

## Деплой

Автоматический: пуш в `main` → GitHub Actions (проверки → деплой на VPS → health-check).

Ручной запасной путь: `pnpm deploy:vps` (параметризуется: `-Target user@host`,
`-Key путь\к\ключу` или env `TASKBOARD_DEPLOY_TARGET` / `TASKBOARD_DEPLOY_KEY`).
Секреты прода хранятся только на сервере (`.env` + мастер-копия вне каталога деплоя).

Статус: ✅ фазы 0–4 (скелет, аккаунты, прод с HTTPS, CI/CD, офлайн-режим) → 🚧 фаза 5 (доски и контент)
