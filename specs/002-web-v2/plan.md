# План реализации v2: дизайн, доступы, аккаунты, доски

- Статус: draft
- Дата: 2026-11-16
- Требования: [`spec.md`](./spec.md) (v2), [`../001-task-board/spec.md`](../001-task-board/spec.md) (v1)
- Принципы: [`../constitution.md`](../constitution.md)

## 1. Границы и принципы

- v2 не переписывает ядро: остаются server-authoritative модель, единый zod-контракт
  в `shared`, оптимистичный UI с реконсиляцией, офлайн-запуск без БД и сети.
- Новые возможности вводятся **аддитивно**: существующие WS-события и REST-поля не
  удаляются и не меняют смысл (кроме типа роли, см. §5 — он расширяется).
- Порядок фаз: **11 → 12 → 13 → 14 → 15 → 16 → 17** (почта — после аккаунта).
- Каждая фаза заканчивается проверками (`typecheck`, `lint`, `build`), деплоем и
  чекпоинт-коммитом.

## 2. Новые зависимости

| Пакет | Зачем | Где |
|---|---|---|
| `tailwindcss`, `@tailwindcss/vite` | утилитарные стили, токены, тёмная тема | client |
| `shadcn` (CLI) + `@radix-ui/*` (по компонентам) | доступные примитивы | client |
| `class-variance-authority`, `clsx`, `tailwind-merge` | варианты компонентов, склейка классов | client |
| `lucide-react` | иконки | client |
| `sonner` | тосты | client |
| `nodemailer` | SMTP-транспорт | server |
| `@playwright/test` | e2e | e2e (workspace) |

Tailwind подключается как Vite-плагин; в `index.css` — `@import "tailwindcss"` и
CSS-переменные тем. Для shadcn нужен alias `@/* → src/*` (vite + tsconfig).

## 3. UI: структура и миграция

- `src/components/ui/*` — компоненты shadcn (Button, Input, Label, Textarea, Card,
  Dialog, DropdownMenu, Select, Tabs, Badge, Avatar, Tooltip, Switch, Skeleton).
- `src/lib/utils.ts` — `cn()`.
- `src/theme/ThemeProvider.tsx` — тема `system | light | dark`, `class` на `<html>`,
  сохранение в localStorage, слушатель `matchMedia`.
- `src/components/ui/sonner.tsx` — тостер; старый самописный `.toast` убирается в конце.

**Порядок миграции (по экранам, без «большого взрыва»):**

1. Auth-экраны (login/register/join).
2. Список досок + профиль.
3. Шапка доски, колонки, карточки, DnD-состояния.
4. Модалки: карточка, шаринг/участники, шаблоны.
5. Удаление старого `index.css` и неиспользуемых классов; финальная проверка тёмной темы.

Старые классы живут до миграции своего экрана — так фаза 11 не блокирует остальные.

## 4. Модель данных (diff)

| Таблица | Изменение |
|---|---|
| `users` | + `email_verified_at` (timestamptz, null), `description` (text), `phone` (text), `messengers` (jsonb), `token_version` (int, default 0) |
| `board_members` | `role` → новый enum `board_role` (`OWNER, ADMIN, EDITOR, VIEWER`); + `favorite` (boolean, default false) |
| `boards` | + `archived_at` (timestamptz, null) |
| `invites` | + `role` (`board_role`, default `EDITOR`), + `email` (text, null — для приглашений по адресу) |
| `email_verifications` (новая) | `id, user_id, token_hash, expires_at, used_at, created_at` |
| `column_templates` (новая) | `id, user_id, title, cards (jsonb), created_at, updated_at` |
| `board_templates` (новая) | `id, user_id, title, columns (jsonb: колонки и карточки), created_at, updated_at` |

**Избранное** — булево поле в `board_members`: пользователь и так состоит в доске,
отдельная таблица не нужна.

### Миграция ролей (важно)

PostgreSQL не умеет удалять значения enum, а смена типа требует `USING`-каста, который
drizzle-kit не генерирует. Поэтому тип **расширяется без пересоздания**:

1. `ALTER TYPE "role" ADD VALUE 'ADMIN' | 'EDITOR' | 'VIEWER'` + снятие default — обычная
   сгенерированная миграция (`0002_v2-role-values.sql`). Добавление значений допустимо в
   транзакции; default снимается, чтобы не использовать новое значение в той же транзакции.
2. `invites.role` (default `EDITOR`) — отдельная сгенерированная миграция
   (`0003_v2-invite-role.sql`).
3. Бэкфилл `MEMBER → EDITOR` — **custom-миграция** (`drizzle-kit generate --custom` —
   штатный механизм для ручного SQL; сгенерированные файлы не правим),
   `0004_v2-role-backfill.sql`.
4. Значение `MEMBER` остаётся в типе как legacy: наружу отдаётся только 4 роли
   (`normalizeRole` в `http/boards.ts`), приложение его не пишет.
5. Проверка миграции — на копии прод-БД (`scripts/prod-db-check.sh` как образец),
   только после этого деплой.

**Порядок применения.** Штатный мигратор drizzle выполняет все неприменённые файлы в
одной транзакции, а PostgreSQL 16 запрещает использовать значения enum, добавленные в
той же транзакции (`55P04: unsafe use of new value`). Локальный PostgreSQL 18 это
допускает, поэтому проблема проявлялась только на проде. Решение: собственный мигратор
`server/src/db/migrations.ts` — **каждый файл в своей транзакции**; его используют и
CLI `db:migrate`, и старт сервера. Проверено на чистом PostgreSQL 16 (6 миграций с нуля,
повторный запуск — 0).

Остальные изменения — обычные аддитивные миграции (новые nullable-колонки и таблицы).

## 5. RBAC

- `shared/src/permissions.ts` — единственный источник истины:
  `BoardRole`, `BoardAction`, матрица и `can(role, action)`. Используется сервером
  (проверки) и клиентом (скрытие действий).
- Действия: `view`, `editContent`, `invite`, `manageMembers`, `renameBoard`,
  `archiveBoard`, `deleteBoard`, `assignAdmin`.
- `board.role` в DTO → `BoardRole`; `members` в снапшоте → `MemberDto { id, name, email, role }`.
- Точки проверки на сервере: REST-роуты досок/участников/шаблонов и **каждый** WS-обработчик
  (`column:*`, `card:*`, `board:rename`). Ошибка — `ws:error { code: 'FORBIDDEN' }` / HTTP 403.
- Архивированная доска: `can()` возвращает `false` для `editContent` (только `view`),
  сервер отвечает `BOARD_ARCHIVED`.

## 6. Почта

- `server/src/mail/mailer.ts` — интерфейс `Mailer { send(msg): Promise<void> }`.
- Транспорты:
  - `console` (по умолчанию для dev/e2e/офлайна): письмо пишется в `.localmail/<ts>-<to>.eml`
    и в лог; ссылка видна в консоли и файле.
  - `smtp` (прод): `nodemailer`, Яндекс (`smtp.yandex.ru:465`, пароль приложения).
- Шаблоны: `server/src/mail/templates/verify-email.ts`, `invite.ts` — текст + HTML,
  ссылки строятся от `ORIGIN`.
- Токены подтверждения: `randomBytes(32)` → base64url; в БД — **sha256-хэш**, срок 24 ч,
  одноразовый; повторная отправка — не чаще 1/мин.
- Подтверждение **идемпотентно**: повторное открытие ссылки возвращает успех, если адрес уже
  подтверждён (почтовые клиенты и StrictMode в dev повторяют запрос; первый вызов помечает
  токен использованным).
- Отправка асинхронная (не блокирует HTTP-ответ), 2–3 повтора с паузой, ошибки в лог.
- Env: `MAIL_MODE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
  `MAIL_FROM`, `MAIL_FROM_NAME`. Секреты — в `.env` на сервере и в мастер-копии.

## 7. REST API (новое и изменённое)

| Метод и путь | Изменение |
|---|---|
| `GET /api/health` | + `apiVersion` |
| `GET /api/boards?archived=0\|1` | фильтр архива; в DTO — `role`, `favorite`, `archivedAt` |
| `PATCH /api/boards/:id` | переименование (владелец/админ) |
| `POST /api/boards/:id/archive` / `restore` | владелец |
| `PATCH /api/boards/:id/favorite` | `{ favorite: boolean }` |
| `GET /api/boards/:id/members` | список с ролями |
| `PATCH /api/boards/:id/members/:userId` | `{ role }` (владелец; назначение ADMIN — только владелец) |
| `DELETE /api/boards/:id/members/:userId` | владелец/админ, кроме владельца |
| `POST /api/boards/:id/invites` | + `role`, + `email` (приглашение по адресу) |
| `GET/PATCH /api/users/me` | профиль: имя, описание, телефон, мессенджеры |
| `POST /api/users/me/password` | `{ currentPassword, newPassword }` → инкремент `tokenVersion` |
| `POST /api/auth/logout-all` | инкремент `tokenVersion`, сброс cookie |
| `POST /api/auth/verify-email` | `{ token }` |
| `POST /api/auth/resend-verification` | лимит 1/мин |
| `GET/POST /api/column-templates`, `DELETE /api/column-templates/:id` | шаблоны колонок |
| `GET/POST /api/board-templates`, `DELETE /api/board-templates/:id` | шаблоны досок (FR-51) |
| `POST /api/boards` | + `templateId` — создать доску из шаблона (одна транзакция) |

Контакты участников приходят в `BoardSnapshot.members` (`MemberDto`): снапшот доступен
только участникам доски, поэтому отдельный `GET /users/:id` не нужен.

JWT: добавляется claim `ver` (tokenVersion). `requireUserId` и WS-handshake сверяют его
с `users.token_version` — так работают смена пароля и «выйти везде».

**Смена аккаунта без перезагрузки:** сокет аутентифицируется только в handshake, поэтому
после входа под другим аккаунтом он продолжал работать от имени прежнего (наблюдатель мог
редактировать). Каждый сокет вступает в личную комнату `user:<id>`; `logout`, `logout-all`
и смена пароля вызывают `disconnectUser()` — клиент переподключается с актуальной cookie.
Покрыто e2e `account-switch.spec.ts`.

## 8. WS-протокол (аддитивно)

| Событие | Направление | Назначение |
|---|---|---|
| `member:updated` | сервер → клиент | изменилась роль участника |
| `member:removed` | сервер → клиент | участник удалён (у него доска пропадает из списка) |
| `board:archived` / `board:restored` | сервер → клиент | архивирование/восстановление |
| `column:create-from-template` | клиент → сервер | создать колонку из шаблона (одна транзакция) |
| `cards:created` | сервер → клиент | батч карточек (после шаблона) |

Новые коды ошибок: `FORBIDDEN`, `BOARD_ARCHIVED`, `EMAIL_NOT_VERIFIED`, `RATE_LIMITED`.

## 9. Клиент: экраны и состояние

| Экран / компонент | Содержание |
|---|---|
| `/profile` | имя, описание, телефон, мессенджеры, статус email, смена пароля, «выйти везде» |
| `/verify-email?token=` | подтверждение, результат, повторная отправка |
| Список досок | вкладки «Все / Избранное / Архив», поиск, сортировка, пункт «Из шаблона…», пустые состояния; оба списка кэшируются, переключение вкладок без мерцания |
| Доска | бейдж роли, баннер «в архиве», действия по правам; «Сохранить как шаблон доски…» |
| Диалог «Поделиться» | участники с ролями, изменение роли, удаление, приглашение ссылкой/по email |
| Колонка | меню: «Сохранить как шаблон»; создание «Из шаблона…» (колонки) |
| Шапка | переключатель темы, статус соединения (v1) |

Состояние по-прежнему в `BoardPage`/`BoardsPage`; права — через `can(myRole, action)`.
Новых глобальных стейт-менеджеров не вводим.

## 10. E2E (Playwright)

- Отдельный workspace-пакет `e2e/`: конфиг, `globalSetup` (регистрация тестовых
  пользователей через API), `storageState` для авторизации.
- Запуск по требованию: `pnpm e2e`, `pnpm e2e:ui`; в CI — отдельная job с `workflow_dispatch`
  и на релизных фазах (NFR-14), не на каждый push.
- Почта в тестах: `MAIL_MODE=console` → тест читает последний `.eml` из `.localmail/`.
- Наборы: auth, доски (CRUD/архив/избранное/поиск), DnD, роли, профиль/пароль,
  подтверждение email, приглашения, шаблоны колонок.
- Данные — уникальные email на прогон; в CI — отдельная БД (сервис-контейнер).

## 11. Контракт для десктопа

- `docs/api-contract.md` — таблицы REST и WS, формат ошибок, авторизация, версия.
  Начинается в фазе 12 (роли), финализируется в 17.
- `apiVersion` в `/api/health`; изменения — только аддитивные.
- **Spike (до кодирования десктопа):** WPF + `HttpClient`/`CookieContainer` + `SocketIOClient`.
  Если cookie-схема не заводится — добавляем `POST /api/auth/token` (Bearer) и фиксируем
  это в спеке v2 (FR-50) до начала разработки десктопа.
- Десктоп — отдельный репозиторий и отдельная спека; веб-спека лишь фиксирует требования
  к API.

## 12. Фазы

| Фаза | Эпик | Результат |
|---|---|---|
| 11 | UI-фундамент | shadcn/Tailwind, тёмная тема, рестайл экранов, Playwright-дым |
| 12 | Доступы | роли, участники, проверки прав, ссылки-приглашения с ролью |
| 13 | Аккаунт | профиль, контакты, смена пароля, инвалидация сессий |
| 14 | Почта | Mailer, Яндекс SMTP, подтверждение email, приглашения по email, ограничения |
| 15 | Доски | архив, избранное, поиск, сортировка, шаблоны колонок |
| 16 | UX | клавиатура, тосты/подтверждения, доступность, мобильные детали |
| 17 | Релиз | полный e2e, контракт, README v2, миграция прода, тег `v2.0` |

## 13. Риски

| Риск | Митигация |
|---|---|
| Рестайл на shadcn растянется | экран за экраном, старый CSS удаляется в конце; е2e-«дым» до перестройки |
| Миграция enum ролей на проде | custom-миграция + прогон на копии БД, бэкап перед деплоем |
| Яндекс SMTP: отправитель и лимиты | отправитель = адрес ящика; делегирование домена вне v2; лимиты в спеке |
| Письма в спаме | отправка через Яндекс, plain-text + HTML, без «сокращалок» |
| Роли ломают WS-сценарии | проверки централизованы в `can()`, покрыты e2e-матрицей |
| Playwright нестабилен | запуск по требованию, ретраи 1, скриншоты/трейсы при падении |
| Десктоп потребует изменений API | контракт + версия, spike до разработки, только аддитивные изменения |

## 14. Деплой и окружение

- Новые env: `MAIL_MODE`, `SMTP_*`, `MAIL_FROM`, `MAIL_FROM_NAME`; `.env.example` обновляется.
- Секреты — в мастер-копии на VPS (`update-secrets.sh`) и в GitHub Secrets при необходимости.
- Порядок выката фазы с миграцией: бэкап БД → миграции на копии → деплой → health-check.
- **Скорость сборки на VPS:** tar с фиксированным `--mtime` (слой `pnpm install` попадает
  в кэш Docker между деплоями) + BuildKit-кэш `pnpm-store` (пакеты не скачиваются заново).
  Рантайм-образ содержит только прод-зависимости сервера и собранный `client/dist`:
  dev-зависимости клиента (react/vite/tailwind) в образ не попадают, поэтому COPY и
  экспорт слоёв занимают секунды вместо минут.
  Push, затрагивающий только `*.md` / `specs/` / `docs/`, деплой не запускает.
- Офлайн-режим сохраняется: без `MAIL_MODE=smtp` письма идут в `.localmail/`.
