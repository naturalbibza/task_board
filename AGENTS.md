# Project instructions

Коллаборативная доска задач (Trello-like): drag-n-drop, реал-тайм через Socket.IO,
шаринг по invite-ссылкам. TypeScript, pnpm workspaces, React+Vite, Express+Socket.IO,
PostgreSQL+Drizzle.

## Spec-Driven Development — обязательно

1. Перед любой задачей прочитай `specs/001-task-board/tasks.md` — там фазы, задачи
   и чекпоинты. Работай строго в рамках текущей фазы.
2. Требования живут в `specs/001-task-board/spec.md`, решения по архитектуре —
   в `specs/001-task-board/plan.md`. Если задача противоречит им — сначала обнови
   спеку/план (и скажи об этом), потом код.
3. Новые требования от пользователя не реализуй молча: отрази их в spec.md
   (или явно пометь как out-of-scope, см. раздел «Вне объёма v1»).
4. В конце фазы отметь выполненные задачи в `tasks.md` и добавь чекпоинт-коммит
   (`docs: phase N done`).

## Команды

```bash
pnpm install            # установка
pnpm dev                # сервер + клиент в dev-режиме
pnpm typecheck          # tsc --noEmit во всех пакетах
pnpm lint               # eslint
pnpm build              # сборка client и server
```

Принципы разработки: см. `specs/constitution.md` (strict TS, server-authoritative,
валидация всего входа через zod в пакете `shared`, Conventional Commits).

## Ключевые правила

- **Не коммитить и не пушить самостоятельно.** git commit / git push — только по явной
  просьбе пользователя; по умолчанию изменения просто оставляются в рабочей копии.

- Контракты (типы и zod-схемы WS-событий, REST DTO) — только в `packages/shared`;
  в `client`/`server` их не дублировать.
- Изменяя WS-протокол или модель данных: сначала `packages/shared` /
  `packages/server/src/db/schema.ts`, потом обработчики и UI.
- Схему БД менять только в Drizzle (`src/db/schema.ts`) с последующим
  `drizzle-kit generate`; сгенерированные SQL-миграции не редактировать вручную.
  Применение миграций: `pnpm --filter @task-board/server db:migrate`.
- Секреты (`JWT_SECRET`, `DATABASE_URL`) — только в `.env`; `.env` не коммитить.
- Сгенерированное (`client/dist`, `node_modules`, миграции-артефакты) не редактировать.
- Перед завершением задачи: `pnpm typecheck && pnpm lint` без ошибок.
