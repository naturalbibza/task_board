import express from 'express';
import cookieParser from 'cookie-parser';
import { env } from './db';
import { authRouter } from './http/auth';
import { errorHandler } from './http/errors';

const app = express();

app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'task-board-server' });
});

app.use('/api/auth', authRouter);

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`[server] listening on http://localhost:${env.PORT}`);
});
