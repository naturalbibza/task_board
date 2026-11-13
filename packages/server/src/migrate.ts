// Идемпотентное применение миграций при старте (используется в CMD контейнера
// и через pnpm db:migrate). drizzle-kit migrate в контейнере падал молча,
// программный мигратор drizzle-orm печатает ошибки явно.
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { db } from './db';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

await migrate(db, { migrationsFolder });
console.log('[migrate] миграции применены');

process.exit(0);
