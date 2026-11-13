import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './db';
import { authRouter } from './http/auth';
import { boardsRouter } from './http/boards';
import { errorHandler } from './http/errors';
import { registerSocketHandlers } from './ws';
import type { ClientToServerEvents, ServerToClientEvents } from '@task-board/shared';

const app = express();

app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'task-board-server' });
});

app.use('/api/auth', authRouter);
app.use('/api/boards', boardsRouter);

// Прод: раздаём собранный клиентский бандл и SPA-fallback (в dev этим занимается Vite)
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use(errorHandler);

// Один HTTP-сервер обслуживает и REST, и WebSocket (план §1)
const httpServer = createServer(app);
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer);
registerSocketHandlers(io);

httpServer.listen(env.PORT, () => {
  console.log(`[server] listening on http://localhost:${env.PORT}`);
});
