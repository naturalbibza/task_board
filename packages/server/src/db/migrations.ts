import { sql, type SQL } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';

interface Queryable {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}

interface Transactional extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

/**
 * Применяет миграции по одной транзакции на файл.
 *
 * Штатный мигратор drizzle оборачивает ВСЕ неприменённые миграции в одну
 * транзакцию, а PostgreSQL 16 запрещает использовать значения enum, добавленные
 * в той же транзакции (ошибка 55P04: unsafe use of new value). Из-за этого
 * миграция `invites.role` (значение EDITOR, добавленное в предыдущей миграции)
 * валила деплой на проде. Локальный PostgreSQL 18 такое допускает — поэтому
 * проблема проявлялась только на сервере.
 *
 * Здесь каждый файл коммитится отдельно: значения enum из `ALTER TYPE ... ADD VALUE`
 * успевают зафиксироваться до следующего файла.
 */
export async function runMigrations(
  database: Transactional,
  migrationsFolder: string,
): Promise<number> {
  const migrations = readMigrationFiles({ migrationsFolder });

  await database.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const appliedRows = await database.execute(
    sql`SELECT hash FROM "drizzle"."__drizzle_migrations"`,
  );
  const applied = new Set(appliedRows.rows.map((row) => String(row.hash)));

  let count = 0;
  for (const migration of migrations) {
    if (applied.has(migration.hash)) continue;
    await database.transaction(async (tx) => {
      for (const statement of migration.sql) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(sql`
        INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
        VALUES (${migration.hash}, ${migration.folderMillis})
      `);
    });
    count += 1;
  }

  return count;
}
