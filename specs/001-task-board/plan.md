# План реализации: Коллаборативная доска задач

- Статус: accepted
- Спека: [spec.md](./spec.md)
- Задачи: [tasks.md](./tasks.md)

## 1. Архитектура

```
┌─────────────────────────── Browser ───────────────────────────┐
│  React SPA (Vite)                                             │
│   ├── REST (fetch): auth, boards CRUD, invites                │
│   └── WebSocket (socket.io-client): контент доски + presence   │
└───────────────────────┬──────────────────┬────────────────────┘
                        │ HTTPS            │ WSS
                ┌───────┴──────────────────┴───────┐
                │  Caddy (reverse proxy, TLS)      │   ← VPS
                └───────┬──────────────────────────┘
                        │
                ┌───────┴────────┐        ┌──────────────┐
                │  Node (server) │ ─────► │  PostgreSQL  │
                │  Express +     │Drizzle │  (том Docker)│
                │  Socket.IO     │        └──────────────┘
                └────────────────┘
```

- Один Node-процесс обслуживает и HTTP, и WS (один порт за прокси — меньше возни с CORS и сессиями).
- Caddy терминирует TLS (автоматические сертификаты) и проксирует `/` на Node.

## 2. Стек

| Слой | Выбор | Обоснование |
|---|---|---|
| Язык | TypeScript, strict | Единый язык клиента и сервера; типобезопасные контракты WS/REST через пакет `shared` |
| Монорепо | pnpm workspaces | Общий `tsconfig`/eslint, пакет `shared` |
| Frontend | React 19 + Vite 6 | Стандарт, быстрый dev-сервер |
| Drag-n-drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Активная поддержка, ts-native, работает по одной оси и между контейнерами |
| Backend | Node 20, Express, Socket.IO | Задание требует WebSockets; Socket.IO даёт room'ы и reconnect |
| ORM/БД | Drizzle ORM + drizzle-kit + PostgreSQL 16 | Схема на TypeScript, SQL-подобный API без «магии», генерация SQL-миграций |
| Валидация | zod | Одна схема — валидация и вывод типа, шарится через `shared` |
| Auth | JWT (jose) в httpOnly cookie | Простой stateless-токен, доступен и в WS-handshake |

## 3. Структура монорепо

```
web/
├── package.json              # workspaces, общие скрипты
├── pnpm-workspace.yaml
├── tsconfig.base.json        # strict, общий для всех пакетов
├── AGENTS.md                 # инструкции для агентов
├── Caddyfile                 # адрес сайта из env SITE_ADDRESS, прокси на app
├── docker-compose.yml        # деплой: app + postgres + caddy
├── Dockerfile                # multi-stage: build client+server → рантайм
├── .github/workflows/        # ci.yml (проверки), deploy.yml (CD на VPS)
├── scripts/                  # deploy.ps1, миграционные/диагностические хелперы
├── .env.example
├── specs/                    # SDD-документы (эта папка)
└── packages/
    ├── shared/               # @task-board/shared
    │   └── src/
    │       ├── ws-events.ts  # типы и zod-схемы всех WS-событий
    │       ├── api-types.ts  # DTO REST-эндпоинтов
    │       └── env.ts        # zod-схема env-переменных
    ├── server/               # @task-board/server
    │   └── src/
    │       ├── index.ts          # поднять Express + Socket.IO на одном порту
    │       ├── http/             # auth, boards, invites (роутеры + middleware)
    │       ├── ws/               # socket.io: auth handshake, board:join, обработчики мутаций, presence
    │       ├── services/         # логика над Drizzle (boards, cards, invites, positions)
    │       └── db/               # schema.ts (Drizzle), drizzle/ (SQL-миграции), client.ts
    └── client/               # @task-board/client
        └── src/
            ├── api/          # REST-обёртки, socket-клиент-синглтон
            ├── state/        # хранилище доски (reducer) с optimistic-применением
            ├── pages/        # login, register, boards, board, join
            └── components/   # Board, Column, Card, DnD-обёртки, MembersBar
```

## 4. Модель данных (Drizzle)

Схема — TypeScript-файл `packages/server/src/db/schema.ts` (единственный источник схемы БД);
SQL-миграции генерируются `drizzle-kit generate` в `packages/server/src/drizzle/` и коммитятся.

```ts
// packages/server/src/db/schema.ts (эскиз)
import { doublePrecision, index, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";

const id = () => text().primaryKey().$defaultFn(() => randomUUID());
const ts = () => timestamp({ withTimezone: true });

export const roleEnum = pgEnum("role", ["OWNER", "MEMBER"]);

export const users = pgTable("users", {
  id: id(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  name: text().notNull(),
  createdAt: ts().notNull().defaultNow(),
});

export const boards = pgTable("boards", {
  id: id(),
  title: text().notNull(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow().$onUpdate(() => new Date()),
});

export const boardMembers = pgTable("board_members", {
  boardId: text().notNull().references(() => boards.id, { onDelete: "cascade" }),
  userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
  role: roleEnum().notNull().default("MEMBER"), // OWNER | MEMBER
  joinedAt: ts().notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.boardId, t.userId] })]);

export const columns = pgTable("columns", {
  id: id(),
  boardId: text().notNull().references(() => boards.id, { onDelete: "cascade" }),
  title: text().notNull(),
  position: doublePrecision().notNull(), // дробная позиция, см. FR-6
  createdAt: ts().notNull().defaultNow(),
}, (t) => [index("columns_board_position_idx").on(t.boardId, t.position)]);

export const cards = pgTable("cards", {
  id: id(),
  columnId: text().notNull().references(() => columns.id, { onDelete: "cascade" }),
  title: text().notNull(),
  description: text(),
  position: doublePrecision().notNull(),
  authorId: text().notNull().references(() => users.id),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index("cards_column_position_idx").on(t.columnId, t.position)]);

export const invites = pgTable("invites", {
  id: id(),
  boardId: text().notNull().references(() => boards.id, { onDelete: "cascade" }),
  token: text().notNull().unique(), // ≥ 32 случайных символа
  expiresAt: ts().notNull(),
  revokedAt: ts(),
  createdBy: text().notNull().references(() => users.id),
  createdAt: ts().notNull().defaultNow(),
});
```

Связи для удобных join-запросов (`users → boards → columns → cards`) описываются
функцией `relations()` в том же файле.

### Позиции (FR-6)
- Вставка между `a.position` и `b.position`: `pos = (a + b) / 2`.
- Вставка в конец: `pos = last + 1024`.
- При `b - a < 0.001` — перенормировка всех позиций колонки/доски (пересчитать с шагом 1024).

## 5. REST API (HTTP)

База: `/api`

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/auth/register` | регистрация + вход (cookie) |
| POST | `/auth/login` | вход |
| POST | `/auth/logout` | выход |
| GET | `/auth/me` | текущий пользователь |
| GET | `/boards` | мои доски (owner + member) |
| POST | `/boards` | создать доску (с колонками по умолчанию) |
| GET | `/boards/:id` | доска + участники (без карточек — карточки по снапшоту WS) |
| PATCH | `/boards/:id` | переименовать (владелец) |
| DELETE | `/boards/:id` | удалить (владелец) |
| GET | `/boards/:id/invites` | активные ссылки (владелец) |
| POST | `/boards/:id/invites` | создать ссылку (владелец) |
| PATCH | `/invites/:id` | отозвать (владелец) |
| GET | `/join/:token` | вступить по ссылке / редирект на логин |

Все ответы и ошибки — типизированы через `@task-board/shared` (NFR-8).

## 6. Протокол WebSocket (Socket.IO)

Аутентификация — в handshake: сервер читает JWT из cookie `token`, при неудаче соединение отклоняется.
Комнаты: `board:<id>`; join только после проверки членства.

### 6.1 Клиент → Сервер (intents)

| Событие | Payload | Ответ (ack/broadcast) |
|---|---|---|
| `board:join` | `{ boardId }` | снапшот `board:state` + вступление в комнату |
| `board:leave` | `{ boardId }` | выход из комнаты |
| `column:create` | `{ boardId, title }` | `column:created` |
| `column:rename` | `{ id, title }` | `column:updated` |
| `column:move` | `{ id, beforeId?, afterId? }` | `column:moved` (+ перенормировка при нужде) |
| `column:delete` | `{ id }` | `column:deleted` (карточки удаляются каскадно) |
| `card:create` | `{ columnId, title, beforeId?, afterId? }` | `card:created` |
| `card:update` | `{ id, title?, description? }` | `card:updated` |
| `card:move` | `{ id, toColumnId, beforeId?, afterId? }` | `card:moved` |
| `card:delete` | `{ id }` | `card:deleted` |
| `card:editing-start/stop` | `{ id }` | presence-метка для UI |
| `board:rename` | `{ boardId, title }` | `board:updated` |

Каждый intent валидируется zod-схемой; ошибка — `ws:error { code, message, requestId }` (A7).

### 6.2 Сервер → Клиент (events)

- `board:state` — полный снапшот: `{ board, columns[], cards[], members[] }`.
- `column:created/updated/moved/deleted`, `card:created/updated/moved/deleted` — delta-события (FR-12), содержат сущность или её id + изменённые поля.
- `board:updated` — переименование доски.
- `presence:update` — `{ users: { userId, name }[] }` — на join/leave/disconnect (FR-14).
- `presence:editing` — `{ cardId, userId | null }[]`.
- `ws:error` — структурированная ошибка мутации.

### 6.3 Модель консистентности

- Сервер авторитетен (конституция №3): intent → валидация → права → транзакция в БД → broadcast в комнату.
- Клиент применяет optimistic-изменение сразу (перетаскивание нельзя тормозить сетью), затем событие от сервера **перезаписывает** optimistic-состояние (reconciliation). Конфликты версии 1 решаются last-write-wins по позиции (для курсового проекта достаточно; race двух одновременных drag'ов редки и сводятся к порядку применения сервером).

## 7. Клиент: состояние доски

- Одно хранилище-редьюсер: `{ columns: Column[], cards: Card[], members, presence }` с событиями `apply-snapshot`, `apply-event`, `apply-optimistic`, `revert-optimistic`.
- DnD: `@dnd-kit/sortable` — колонки сортируются по горизонтали, карточки по вертикали, перенос между колонками через общий `DndContext`.
- Локальное состояние редактирования текста — «своё», чужое редактирование показывается бейджем (presence:editing).

## 8. Деплой и CI/CD (NFR-6, NFR-9, NFR-10)

Стратегия — **ранний деплой**: первый выкат после фазы 1 (версия с аккаунтами),
далее ре-деплой в конце каждой фазы. Прод всегда показывает последнюю принятую
фазу; риск «всё работает локально, но не на сервере» снят в начале проекта.

### 8.1 Ручной деплой (сделан в фазе 2)

- `docker-compose.yml`: сервисы `app` (собранный бандл: Express раздаёт `client/dist` + WS), `postgres` (том `pgdata`), `caddy` (80/443, `Caddyfile`).
- Миграции применяются на старте контейнера `app` (программный мигратор drizzle-orm: `tsx src/migrate.ts`, идемпотентно; drizzle-kit — только для генерации).
- Env: `DATABASE_URL`, `JWT_SECRET`, `COOKIE_DOMAIN`, `ORIGIN` — в `.env` на сервере, в репозитории только `.env.example`.
- HTTPS автоматом через Caddy (домен bibza.ru, сертификаты Let's Encrypt).
- Ре-деплой вручную — `pnpm deploy:vps` (остаётся как запасной путь при недоступности Actions).

### 8.2 CI/CD (фаза 3)

- **CI** (`.github/workflows/ci.yml`): на push и PR в любой ветке — `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `build`. Красная сборка блокирует мерж.
- **CD** (`.github/workflows/deploy.yml`): при пуше в `main` после зелёного CI — tar-загрузка исходников на VPS (как в ручном деплое; rsync на сервере нет) → `docker compose build && up -d` → health-check с ретраями.
- Секреты Actions (создаются в UI GitHub): `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` — выделенная ключ-пара только для деплоя; публичный ключ добавляется в `authorized_keys` пользователя `bibza`.
- Правило: прод обновляется только через main; прямые правки на сервере запрещены (кроме секретов).

### 8.3 Автономный локальный запуск (фаза 4)

- Вариант «ноутбук в университете»: без сети, Docker и внешней БД.
- Сервер при отсутствии `DATABASE_URL` поднимает встроенный PostgreSQL
  (пакет `embedded-postgres`, бинарники zonky; порт ~54329, данные в
  `packages/server/.localdb/`, в gitignore). Схема остаётся PostgreSQL-одной —
  никаких дублирующих SQLite-схем.
- Миграции применяются к встроенной БД тем же мигратором при старте.
- Fallback, если на ноутбуке есть Docker: полный стек через тот же compose.

## 9. Риски

| Риск | Митигация |
|---|---|
| Socket.IO cookie-handshake неочевиден | Отдельная задача в фазе 6 с ручной проверкой до мутаций |
| Деградация точности float-позиций | Правило перенормировки (§4), тест в фазе 7 |
| Два одновременных drag'а одного объекта | Server-authoritative + LWW по позиции; в v1 осознанно принимаем |
| TLS/прокси на VPS | Caddy выбирается именно из-за простоты; весь деплой-контур (TLS, cookie, WSS-проксирование) отлаживается в фазе 2, задолго до реал-тайм-фаз |
