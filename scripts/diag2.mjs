import pg from 'pg';

const url = process.env.DATABASE_URL ?? '';
const direct = url.replace('@db:', '@172.18.0.3:');

async function tryConnect(label, connStr) {
  const client = new pg.Client({ connectionString: connStr });
  try {
    await client.connect();
    const res = await client.query('select current_user, current_database(), version()');
    console.log(label, '-> OK:', res.rows[0].current_user, res.rows[0].current_database, '|', res.rows[0].version.slice(0, 30));
    await client.end();
  } catch (e) {
    console.log(label, '-> FAIL:', e.code, e.message);
  }
}

await tryConnect('via db:', url);
await tryConnect('via 172.18.0.3:', direct);
