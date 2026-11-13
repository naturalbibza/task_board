import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { loadServerEnv } from '@task-board/shared';
import * as schema from './schema';

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/server/src/db
const serverRoot = path.resolve(here, '../..'); // packages/server
const localDbDir = path.join(serverRoot, '.localdb'); // данные встроенного PostgreSQL (initdb требует пустой каталог)
const jwtFile = path.join(serverRoot, '.localdb.jwt'); // сгенерированный JWT-секрет — отдельно от каталога данных

/**
 * Автономный режим (NFR-10): если DATABASE_URL/JWT_SECRET не заданы, сервер
 * сам поднимает встроенный PostgreSQL (порт 54329, данные в .localdb) и
 * генерирует постоянный JWT-секрет. Прод всегда получает значения из compose.
 */
async function bootstrapLocal(): Promise<void> {
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

  if (process.env.DATABASE_URL) return;

  const url = 'postgres://postgres:postgres@localhost:54329/task_board';
  if (await isPostgresUp(url)) {
    console.log('[db] встроенный PostgreSQL уже запущен — подключаюсь (порт 54329)');
  } else {
    console.log('[db] DATABASE_URL не задан — поднимаю встроенный PostgreSQL (порт 54329, данные: packages/server/.localdb)...');
    mkdirSync(localDbDir, { recursive: true });
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const pg = new EmbeddedPostgres({
      databaseDir: localDbDir,
      user: 'postgres',
      password: 'postgres',
      port: 54329,
      persistent: true,
    });
    if (!existsSync(path.join(localDbDir, 'PG_VERSION'))) {
      await pg.initialise();
    }
    await pg.start();
    try {
      await pg.createDatabase('task_board');
    } catch {
      // БД уже создана с прошлого запуска
    }
  }
  process.env.DATABASE_URL = url;
}

async function isPostgresUp(url: string): Promise<boolean> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

await bootstrapLocal();

export const env = loadServerEnv();

export const db = drizzle(new Pool({ connectionString: env.DATABASE_URL }), { schema });

// Схема всегда актуальна на старте: миграции идемпотентны (прод прогоняет их же в CMD)
await migrate(db, { migrationsFolder: path.join(serverRoot, 'drizzle') });
