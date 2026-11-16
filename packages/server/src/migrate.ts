// Идемпотентное применение миграций (используется в CMD контейнера и через pnpm db:migrate).
// Каждый файл применяется отдельной транзакцией — см. db/migrations.ts (enum на PG16).
import { fileURLToPath } from 'node:url';
import { db } from './db';
import { runMigrations } from './db/migrations';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

const applied = await runMigrations(db, migrationsFolder);
console.log(`[migrate] применено новых миграций: ${applied}`);

process.exit(0);
