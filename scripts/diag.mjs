import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const tables = await client.query("select tablename from pg_tables where schemaname='public'");
console.log('TABLES:', tables.rows.map((r) => r.tablename).join(', ') || '(none)');
try {
  const j = await client.query('select hash, created_at from drizzle.__drizzle_migrations');
  console.log('JOURNAL:', j.rows.map((r) => String(r.hash).slice(0, 8)).join(', ') || '(empty)');
} catch (e) {
  console.log('JOURNAL ERROR:', e.message);
}
await client.end();
