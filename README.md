# Task Board

Коллаборативная доска задач (типа Trello): drag-n-drop, обновления в реальном времени
через WebSockets, шаринг досок по invite-ссылкам.

## Стек

TypeScript (strict) · pnpm workspaces · React + Vite · @dnd-kit · Node.js + Express +
Socket.IO · PostgreSQL + Drizzle · zod · Docker Compose (VPS + Caddy/TLS)

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

Статус: ✅ фаза 0 (скелет монорепо) → 🚧 фаза 1 (аккаунты).
