import express from 'express';
import { loadServerEnv } from '@task-board/shared';

const env = loadServerEnv();

const app = express();

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'task-board-server' });
});

app.listen(env.PORT, () => {
  console.log(`[server] listening on http://localhost:${env.PORT}`);
});
