import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { loadServerEnv } from '@task-board/shared';
import * as schema from './schema';

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/server/src/db
const serverRoot = path.resolve(here, '../..'); // packages/server
const localDbDir = path.join(serverRoot, '.localdb'); // данные встроенного PostgreSQL (initdb требует пустой каталог)
const jwtFile = path.join(serverRoot, '.localdb.jwt'); // сгенерированный JWT-секрет — отдельно от каталога данных

type DbMode = 'embedded' | 'external';

/**
 * Режим БД: USE_EXTERNAL_DB=1|0 явно, иначе авто — external при заданном
 * DATABASE_URL, встроенная БД в противном случае (NFR-10).
 */
function resolveDbMode(): DbMode {
  const raw = process.env.USE_EXTERNAL_DB?.trim();
  if (raw === '1') return 'external';
  if (raw === '0') return 'embedded';
  return process.env.DATABASE_URL ? 'external' : 'embedded';
}

/**
 * Автономный режим (NFR-10): если работает встроенная БД, сервер сам поднимает
 * встроенный PostgreSQL (порт 54329, данные в .localdb) и генерирует
 * постоянный JWT-секрет. Прод всегда получает значения из compose.
 */
async function bootstrapLocal(): Promise<void> {
  const mode = resolveDbMode();

  if (mode === 'external') {
    if (!process.env.DATABASE_URL) {
      throw new Error('USE_EXTERNAL_DB=1, но DATABASE_URL не задан — задайте DATABASE_URL или уберите USE_EXTERNAL_DB');
    }
    if (!process.env.JWT_SECRET) {
      throw new Error('USE_EXTERNAL_DB=1, но JWT_SECRET не задан');
    }
    return;
  }

  if (process.env.DATABASE_URL) {
    console.log('[db] USE_EXTERNAL_DB=0 — DATABASE_URL игнорируется, работаю со встроенным PostgreSQL');
  }

  if (!process.env.JWT_SECRET) {
    if (existsSync(jwtFile)) {
      process.env.JWT_SECRET = readFileSync(jwtFile, 'utf8').trim();
    } else {
      const secret = randomBytes(32).toString('hex');
      writeFileSync(jwtFile, secret);
      process.env.JWT_SECRET = secret;
    }
    console.log('[db] JWT_SECRET не задан — сгенерирован и сохранён в packages/server/.localdb.jwt');
  }

  const port = 54329;
  // Проверка готовности идёт на служебной базе "postgres" — "task_board" может ещё не существовать
  const serverUrl = `postgres://postgres:postgres@localhost:${port}/postgres`;
  const appUrl = `postgres://postgres:postgres@localhost:${port}/task_board`;
  if (await isPostgresUp(serverUrl)) {
    console.log(`[db] встроенный PostgreSQL уже запущен — подключаюсь (порт ${port})`);
  } else {
    await startEmbedded(port);
  }
  if (!(await isPostgresUp(appUrl))) {
    // Создание БД — в дочернем процессе node: in-process подключение в этом месте
    // на Windows может зависнуть навсегда (замечено на pg 8.16 + node 20.15)
    const createDbCode = `const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.PGURL });
  await client.connect();
  try {
    await client.query('CREATE DATABASE "task_board"');
    console.log('[db] БД task_board создана');
  } catch (e) {
    if (String(e.message).includes('already exists')) {
      console.log('[db] БД task_board уже существует');
    } else {
      throw e;
    }
  }
  await client.end();
})().catch((e) => { console.error('[db] createDatabase:', e.message); process.exit(1); });`;
    await run(process.execPath, ['-e', createDbCode], {
      cwd: serverRoot,
      env: { ...process.env, PGURL: serverUrl },
    });
  }
  process.env.DATABASE_URL = appUrl;
}

/** Стартует встроенный PostgreSQL на порту и дожидается готовности через служебную базу. */
async function startEmbedded(port: number): Promise<void> {
  const { initdb, pg_ctl } = await binaries();
  mkdirSync(localDbDir, { recursive: true });
  if (!existsSync(path.join(localDbDir, 'PG_VERSION'))) {
    console.log(`[db] initdb (каталог: packages/server/.localdb)...`);
    await run(initdb, ['-D', localDbDir, '-U', 'postgres', '-A', 'trust']);
  }
  console.log(`[db] pg_ctl start (порт ${port})...`);
  await run(pg_ctl, ['-D', localDbDir, '-o', `-p ${port}`, '-w', '-t', '30', 'start']);
}

type Binaries = { pg_ctl: string; initdb: string; postgres: string };

/** Пути к бинарникам встроенного PostgreSQL из платформенного пакета. */
async function binaries(): Promise<Binaries> {
  const p = platform();
  const pkg = p === 'win32'
    ? '@embedded-postgres/windows-x64'
    : p === 'darwin'
      ? '@embedded-postgres/darwin-x64'
      : '@embedded-postgres/linux-x64';
  return import(pkg);
}

/** Запускает бинарник/скрипт, наследуя вывод в консоль; resolve при коде 0. */
function run(
  exe: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(exe)} завершился с кодом ${code}`)),
    );
  });
}

function pgClient(url: string): Client {
  return new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
}

async function isPostgresUp(url: string): Promise<boolean> {
  const client = pgClient(url);
  try {
    // Жёсткий лимит: зомби-сокет может принимать TCP и не отвечать на хендшейк —
    // сама попытка подключения не должна длиться дольше 3 секунд.
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 3000)),
    ]);
    await client.end();
    return true;
  } catch {
    void client.end().catch(() => undefined);
    return false;
  }
}

await bootstrapLocal();

export const env = loadServerEnv();

export const db = drizzle(new Pool({ connectionString: env.DATABASE_URL }), { schema });

// Схема всегда актуальна на старте: миграции идемпотентны (прод прогоняет их же в CMD)
await migrate(db, { migrationsFolder: path.join(serverRoot, 'drizzle') });
console.log('[db] миграции применены');
