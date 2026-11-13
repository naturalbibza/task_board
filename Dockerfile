# --- Сборка: зависимости всех пакетов + сборка клиента ---
FROM node:20-alpine AS build
RUN npm install -g pnpm@10
WORKDIR /app

# Сначала только манифесты — слой зависимостей кэшируется между сборками
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN pnpm install --frozen-lockfile

# Затем исходники и сборка клиентского бандла
COPY . .
RUN pnpm --filter @task-board/client build

# --- Рантайм: тот же workspace целиком (tsx + drizzle-kit уже в node_modules) ---
FROM node:20-alpine
RUN npm install -g pnpm@10
WORKDIR /app
COPY --from=build /app /app

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Миграции применяются при каждом старте контейнера (идемпотентны)
CMD ["sh", "-c", "pnpm --filter @task-board/server db:migrate && pnpm --filter @task-board/server start"]
