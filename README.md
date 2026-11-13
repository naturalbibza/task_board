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
cp .env.example .env      # заполнить DATABASE_URL и JWT_SECRET
pnpm dev                  # сервер + клиент в dev-режиме
```

## Деплой

Автоматический: пуш в `main` → GitHub Actions (проверки → деплой на VPS → health-check).

Ручной запасной путь: `pnpm deploy:vps` (параметризуется: `-Target user@host`,
`-Key путь\к\ключу` или env `TASKBOARD_DEPLOY_TARGET` / `TASKBOARD_DEPLOY_KEY`).
Секреты прода хранятся только на сервере (`.env` + мастер-копия вне каталога деплоя).

Статус: ✅ фазы 0–3 (скелет, аккаунты, прод с HTTPS, CI/CD) → 🚧 фаза 4 (локальный запуск без PostgreSQL)
