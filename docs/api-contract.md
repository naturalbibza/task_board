# API-контракт Task Board v2

Источник истины для веб- и будущего десктоп-клиента (FR-48). Версия контракта —
`2.0`, отдаётся в `GET /api/health` (`apiVersion`). В рамках v2 изменения только
аддитивные (FR-49): существующие поля и события не удаляются и не меняют смысл.

- Прод: `https://bibza.ru`
- REST: `/api/*`
- WebSocket (Socket.IO): тот же origin, транспорт `websocket`/`polling`
- Формат данных: JSON, даты — ISO 8601 (`2026-11-25T12:00:00.000Z`)

Типы DTO и zod-схемы живут в `packages/shared` (`api-types.ts`, `ws-events.ts`) —
десктопный клиент может повторять их вручную или генерировать из этого документа.

## Авторизация

Сессия — httpOnly-cookie `token` (JWT HS256, срок 7 дней, `SameSite=Lax`).
После `POST /api/auth/register` и `POST /api/auth/login` сервер ставит cookie;
браузер отправляет её автоматически.

- Не-браузерный клиент обязан хранить cookie `token` и прикладывать её к REST-запросам
  (`Cookie: token=...`) и к handshake Socket.IO.
- Заголовка `Authorization` нет. CSRF-токена нет — защита на `SameSite=Lax` + httpOnly.
- Смена пароля и `logout-all` инкрементируют `users.tokenVersion`: старые cookie и
  сокеты становятся недействительными (`401 SESSION_INVALID`).

## Ошибки

Единый формат (NFR-8):

```json
{ "error": { "code": "FORBIDDEN", "message": "Недостаточно прав для этого действия" } }
```

| HTTP | Код | Когда |
|---|---|---|
| 400 | `VALIDATION` | тело/параметры не прошли zod |
| 400 | `INVALID_TARGET` | колонка принадлежит другой доске |
| 400 | `BOARD_ALREADY_ARCHIVED` | повторное архивирование |
| 400 | `VERIFICATION_INVALID` | ссылка подтверждения недействительна/истекла |
| 401 | `UNAUTHORIZED` | нет или невалидная cookie |
| 401 | `SESSION_INVALID` | `tokenVersion` устарел (пароль/выход везде) |
| 403 | `FORBIDDEN` | роль не позволяет действие |
| 403 | `EMAIL_NOT_VERIFIED` | ограничения FR-32 |
| 403 | `BOARD_ARCHIVED` | доска в архиве — только просмотр |
| 403 | `INVITE_INVALID` | ссылка отозвана/истекла |
| 403 | `INVITE_EMAIL_MISMATCH` | приглашение на другой email |
| 404 | `BOARD_NOT_FOUND`, `CARD_NOT_FOUND`, `COLUMN_NOT_FOUND`, `MEMBER_NOT_FOUND`, `INVITE_NOT_FOUND`, `TEMPLATE_NOT_FOUND` | объект не найден или нет доступа |
| 429 | `RATE_LIMITED` | письмо чаще 1/мин; приглашения чаще 20/час |
| 500 | `INTERNAL` | непредвиденная ошибка |

## REST

### Служебное

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/api/health` | `{ status: "ok", service: "task-board-server", apiVersion: "2.0" }` |

### Auth

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/api/auth/register` | `{ email, password (≥8), name? }` | `201 { user }` + cookie |
| POST | `/api/auth/login` | `{ email, password }` | `{ user }` + cookie |
| POST | `/api/auth/logout` | — | `{ ok: true }`, cookie сброшена, сокеты закрыты |
| POST | `/api/auth/logout-all` | — | `{ ok: true }`, все прочие сессии недействительны |
| GET | `/api/auth/me` | — | `{ user }` |
| POST | `/api/auth/verify-email` | `{ token }` | `{ ok, alreadyVerified? }` (идемпотентно) |
| POST | `/api/auth/resend-verification` | — | `{ ok, alreadyVerified? }`; 429 чаще 1/мин |

`UserDto = { id, email, name, emailVerified }`.

### Профиль

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/api/users/me` | — | `{ user: UserProfileDto }` |
| PATCH | `/api/users/me` | `{ name?, description?, phone?, messengers? }` | `{ user }` |
| POST | `/api/users/me/password` | `{ currentPassword, newPassword (≥8) }` | `{ ok }`; инвалидирует другие сессии |

`UserProfileDto = { id, email, name, description, phone, messengers, createdAt }`,
`messengers = [{ type: "telegram" | "whatsapp" | "other", value }]`.

### Доски

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/api/boards?archived=1` | — | `{ boards: BoardDto[] }` (активные или архивные) |
| POST | `/api/boards` | `{ title, templateId? }` | `201 { board }`; нужен подтверждённый email |
| GET | `/api/boards/:id` | — | `BoardSnapshot` |
| PATCH | `/api/boards/:id` | `{ title }` | `BoardSnapshot` (OWNER/ADMIN) |
| DELETE | `/api/boards/:id` | — | `{ ok: true }` (OWNER) |
| POST | `/api/boards/:id/archive` | — | `BoardSnapshot` (OWNER) |
| POST | `/api/boards/:id/restore` | — | `BoardSnapshot` (OWNER) |
| PATCH | `/api/boards/:id/favorite` | `{ favorite: boolean }` | `{ boardId, favorite }` (любой участник) |

`BoardDto = { id, title, createdAt, updatedAt, role, archivedAt, favorite }`,
`role ∈ OWNER | ADMIN | EDITOR | VIEWER`, `archivedAt = string | null`.

`BoardSnapshot = { board: BoardDto, columns: ColumnDto[], cards: CardDto[], members: MemberDto[] }`.

Создание доски из шаблона (`templateId`): колонки и карточки копируются одной транзакцией.
`templateId` — системный (`system-board-project`, `system-board-study`) или свой.

### Участники

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/api/boards/:id/members` | — | `{ members: MemberDto[] }` |
| PATCH | `/api/boards/:id/members/:userId` | `{ role: "ADMIN" \| "EDITOR" \| "VIEWER" }` | `{ member }` |
| DELETE | `/api/boards/:id/members/:userId` | — | `{ ok: true, revokedInvites: number }` |

`MemberDto = { id, name, email, role, description, phone, messengers }`.
Права на изменение ролей — по матрице (см. ниже). Владельца изменить/удалить нельзя.

### Приглашения

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/api/boards/:id/invites` | — | `{ invites: InviteDto[] }` (нужно право `invite`) |
| POST | `/api/boards/:id/invites` | `{ role?, email? }` | `201 { invite }`; лимит 20/час на пользователя |
| PATCH | `/api/invites/:id` | — | `{ invite }` — отзыв |
| GET | `/api/join/:token` | — | `{ boardId, boardTitle }`; без входа — `401` |

`InviteDto = { id, token, expiresAt, revoked, role, email }`.
Срок ссылки — 7 дней. Приглашение с `email` принимает только этот адрес
(`INVITE_EMAIL_MISMATCH`). Вступление повторно — успех без смены роли.

### Шаблоны

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/api/column-templates` | — | `{ templates: ColumnTemplateDto[] }` (системные + свои) |
| POST | `/api/column-templates` | `{ columnId, title? }` | `201 { template }` |
| DELETE | `/api/column-templates/:id` | — | `{ ok: true }` (только свой) |
| GET | `/api/board-templates` | — | `{ templates: BoardTemplateDto[] }` (системные + свои) |
| POST | `/api/board-templates` | `{ boardId, title? }` | `201 { template }` |
| DELETE | `/api/board-templates/:id` | — | `{ ok: true }` (только свой) |

`ColumnTemplateDto = { id, title, cards: [{ title, description }], system }`,
`BoardTemplateDto = { id, title, columns: [{ title, cards: [...] }], system }`.

## Права (FR-23)

| Действие | OWNER | ADMIN | EDITOR | VIEWER |
|---|---|---|---|---|
| `view` | ✓ | ✓ | ✓ | ✓ |
| `editContent` (колонки/карточки) | ✓ | ✓ | ✓ | — |
| `invite` | ✓ | ✓ | — | — |
| `manageMembers` | ✓ | ✓ | — | — |
| `renameBoard` | ✓ | ✓ | — | — |
| `archiveBoard` / `deleteBoard` | ✓ | — | — | — |
| `assignAdmin` | ✓ | — | — | — |

Неподтверждённый email (FR-32): нельзя создавать доски, приглашать и управлять
участниками, редактировать чужие доски; собственные доски редактировать можно.
Архивная доска — только просмотр, кроме восстановления и удаления владельцем.

## WebSocket

Подключение: Socket.IO к тому же origin (path `/socket.io`), cookie `token` в handshake.
Невалидная/устаревшая cookie → handshake error `UNAUTHORIZED`. После реконнекта клиент
заново шлёт `board:join` и получает актуальный `board:state` (FR-13).

### Клиент → сервер (intents)

| Событие | Payload |
|---|---|
| `board:join` | `{ boardId }` — вход в комнату `board:<id>` и получение снапшота |
| `board:leave` | `{ boardId }` |
| `column:create` | `{ boardId, title }` |
| `column:create-from-template` | `{ boardId, templateId, title? }` |
| `column:rename` | `{ id, title }` |
| `column:move` | `{ id, beforeId?, afterId? }` |
| `column:delete` | `{ id }` |
| `card:create` | `{ columnId, title, description? }` |
| `card:update` | `{ id, title?, description? }` |
| `card:move` | `{ id, toColumnId, beforeId?, afterId? }` |
| `card:delete` | `{ id }` |
| `board:rename` | `{ boardId, title }` |
| `card:editing-start` / `card:editing-stop` | `{ cardId }` |
| `ping` | ack-функция (живость соединения) |

Все intents валидируются zod. Порядок `*:move` задаётся соседями: `afterId` —
«встать сразу после», `beforeId` — «встать сразу перед»; позиция — среднее.
Мутации одной доски выполняются последовательно (очередь на сервере).

### Сервер → клиент (события)

| Событие | Payload |
|---|---|
| `board:state` | `BoardSnapshot` — полный снапшот при входе |
| `board:updated` | `{ boardId, title }` |
| `board:archived` | `{ boardId, archivedAt }` |
| `board:restored` | `{ boardId, archivedAt: null }` |
| `column:created` / `column:updated` | `{ column: ColumnDto }` |
| `column:moved` | `{ columns: ColumnDto[] }` |
| `column:deleted` | `{ columnId }` |
| `card:created` / `card:updated` | `{ card: CardDto }` |
| `cards:created` | `{ cards: CardDto[] }` (батч после вставки шаблона) |
| `card:moved` | `{ cards: CardDto[] }` (карточки затронутых колонок) |
| `card:deleted` | `{ cardId, columnId }` |
| `member:updated` | `{ boardId, member }` |
| `member:removed` | `{ boardId, userId }` |
| `presence:update` | `{ boardId, users: [{ userId, name }] }` |
| `presence:editing` | `{ cardId, userId \| null }` |
| `ws:error` | `{ code, message }` — коды как у REST |

`ColumnDto = { id, boardId, title, position }`,
`CardDto = { id, columnId, title, description, position, authorId, createdAt, updatedAt }`.

## Десктопный клиент (заметки)

1. `HttpClientHandler` с `CookieContainer` + `HttpClient` — cookie сохраняется сама;
   на старте проверяйте `GET /api/auth/me`.
2. Socket.IO: `SocketIOClient` с тем же origin и заголовком `Cookie: token=...`
   (handshake читает именно cookie). После `connect` — `board:join`.
3. Ошибки REST — по `error.code`, а не по тексту; тексты могут меняться.
4. `apiVersion` сверять при старте; при мажорном расхождении — предупредить пользователя.
5. Все изменения контента — только через WS; REST для контента вернёт 404.
