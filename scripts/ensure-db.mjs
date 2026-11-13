// Разовый скрипт диагностики/создания БД (запускается вручную из packages/server):
//   node ../../scripts/ensure-db.mjs
import pg from 'pg';

const serverUrl = 'postgres://postgres:postgres@localhost:54329/postgres';
const client = new pg.Client({ connectionString: serverUrl });
await client.connect();
try {
  await client.query('CREATE DATABASE "task_board"');
  console.log('CREATED task_board');
} catch (e) {
  console.log('CREATE failed:', e.message);
}
const r = await client.query('select datname from pg_database order by datname');
console.log('DBS:', r.rows.map((x) => x.datname).join(', '));
await client.end();
