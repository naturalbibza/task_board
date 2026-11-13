// Socket-синглтон: одно соединение на вкладку, авто-reconnect и вотчдог живости.
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@task-board/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;
let watchdogStarted = false;

/**
 * Вотчдог: раз в 15 с шлём ping с ack. Если живой сервер не ответил за 5 с —
 * соединение считается мёртвым (bfcache, NAT, сон ноутбука) и пересоздаётся.
 * socket.io сам по себе такие «полуживые» сокеты не всегда замечает.
 */
function startWatchdog(sock: AppSocket): void {
  if (watchdogStarted) return;
  watchdogStarted = true;

  const check = () => {
    if (!sock.connected) return; // socket.io переподключится сам
    let pong = false;
    const timer = setTimeout(() => {
      if (!pong) {
        console.warn('[ws] нет ответа на ping — пересоздаём соединение');
        sock.disconnect();
        sock.connect();
      }
    }, 5000);
    sock.emit('ping', () => {
      pong = true;
      clearTimeout(timer);
    });
  };

  setInterval(check, 15000);

  // Возврат во вкладку (в т.ч. из bfcache): проверить/поднять соединение
  window.addEventListener('pageshow', (e: PageTransitionEvent) => {
    if (e.persisted) {
      sock.disconnect();
      sock.connect();
      check();
    } else if (!sock.connected) {
      sock.connect();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

export function getSocket(): AppSocket {
  if (!socket) {
    // same-origin: dev — через прокси Vite (/socket.io), прод — через Caddy
    socket = io({ withCredentials: true });
    startWatchdog(socket);
  }
  return socket;
}
