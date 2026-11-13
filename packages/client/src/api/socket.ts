// Socket-синглтон: одно соединение на вкладку, авто-reconnect из коробки.
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@task-board/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socket) {
    // same-origin: dev — через прокси Vite (/socket.io), прод — через Caddy
    socket = io({ withCredentials: true });
  }
  return socket;
}
