# syntax=docker/dockerfile:1.7
# --- Сборка клиента (полный install, dev-зависимости нужны для vite/tsc) ---
FROM node:20-alpine AS build
RUN npm install -g pnpm@10
WORKDIR /app

# Сначала только манифесты — слой зависимостей кэшируется между сборками
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
COPY e2e/package.json e2e/package.json
# Кэш pnpm-store между сборками: пакеты не скачиваются заново
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Затем исходники и сборка клиентского бандла
COPY . .
RUN pnpm --filter @task-board/client build

# --- Рантайм: только сервер и собранный клиент, без dev-зависимостей клиента ---
# Раньше сюда копировался весь workspace (~650 МБ) — из-за этого каждый деплой
# тратил по ~4 минуты на COPY и ещё ~4 на экспорт образа на 1 vCPU.
FROM node:20-alpine
RUN npm install -g pnpm@10
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
COPY e2e/package.json e2e/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @task-board/server...

COPY packages/shared packages/shared
COPY packages/server packages/server
COPY --from=build /app/packages/client/dist packages/client/dist

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Миграции применяются при каждом старте контейнера (идемпотентны)
CMD ["sh", "-c", "pnpm --filter @task-board/server db:migrate && pnpm --filter @task-board/server start"]
