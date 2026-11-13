// WS-СЃР»РѕР№: Р°СѓС‚РµРЅС‚РёС„РёРєР°С†РёСЏ РїРѕ cookie РІ handshake, РєРѕРјРЅР°С‚С‹ board:<id>, presence (FR-9, FR-14).
import { and, eq } from 'drizzle-orm';
import type { Server as IOServer } from 'socket.io';
import {
  boardJoinSchema,
  boardLeaveSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@task-board/shared';
import type { Socket } from 'socket.io';
import { db } from '../db';
import { boardMembers, users } from '../db/schema';
import { boardSnapshot } from '../http/boards';
import { COOKIE_NAME, verifySessionToken } from '../http/session';

type Io = IOServer<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, SocketData>;

/** Р Р°Р·Р±РѕСЂ cookie-Р·Р°РіРѕР»РѕРІРєР° handshake (cookie-parser РЅР° WS РЅРµ РґРµР№СЃС‚РІСѓРµС‚). */
function parseCookie(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

const roomOf = (boardId: string) => `board:${boardId}`;

/** Presence-СЂР°СЃСЃС‹Р»РєР°: СѓРЅРёРєР°Р»СЊРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»Рё РєРѕРјРЅР°С‚С‹ (FR-14). */
async function broadcastPresence(io: Io, boardId: string): Promise<void> {
  const sockets = await io.in(roomOf(boardId)).fetchSockets();
  const byUser = new Map<string, { userId: string; name: string }>();
  for (const s of sockets as Iterable<Sock>) {
    const data = (s as Sock).data;
    if (data?.userId) byUser.set(data.userId, { userId: data.userId, name: data.name });
  }
  io.to(roomOf(boardId)).emit('presence:update', { boardId, users: [...byUser.values()] });
}

export function registerSocketHandlers(io: Io): void {
  // РђСѓС‚РµРЅС‚РёС„РёРєР°С†РёСЏ РІ handshake: JWT РёР· httpOnly-cookie (FR-9, NFR-5)
  io.use(async (socket, next) => {
    try {
      const token = parseCookie(socket.handshake.headers.cookie ?? '', COOKIE_NAME);
      const userId = token ? await verifySessionToken(token) : null;
      if (!userId) return next(new Error('UNAUTHORIZED'));
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return next(new Error('UNAUTHORIZED'));
      const data = socket.data as SocketData;
      data.userId = user.id;
      data.name = user.name;
      data.rooms = new Set();
      next();
    } catch (e) {
      next(new Error(`AUTH_FAILED: ${String(e)}`));
    }
  });

  io.on('connection', (socket) => {
    const data = socket.data as SocketData;

    socket.on('board:join', async (raw) => {
      const parsed = boardJoinSchema.safeParse(raw);
      if (!parsed.success) {
        socket.emit('ws:error', { code: 'VALIDATION', message: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ board:join' });
        return;
      }
      const { boardId } = parsed.data;
      const [membership] = await db
        .select()
        .from(boardMembers)
        .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, data.userId)));
      if (!membership) {
        socket.emit('ws:error', { code: 'BOARD_NOT_FOUND', message: 'Р”РѕСЃРєР° РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё РЅРµС‚ РґРѕСЃС‚СѓРїР°' });
        return;
      }
      await socket.join(roomOf(boardId));
      data.rooms.add(boardId);
      // РџРѕР»РЅС‹Р№ СЃРЅР°РїС€РѕС‚ С‚РѕР»СЊРєРѕ СЌС‚РѕРјСѓ СЃРѕРєРµС‚Сѓ (FR-13: РїСЂРёСЃРѕРµРґРёРЅРёРІС€РёР№СЃСЏ РїРѕР»СѓС‡Р°РµС‚ Р°РєС‚СѓР°Р»СЊРЅРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ)
      socket.emit('board:state', await boardSnapshot(boardId, membership.role));
      await broadcastPresence(io, boardId);
    });

    socket.on('board:leave', async (raw) => {
      const parsed = boardLeaveSchema.safeParse(raw);
      if (!parsed.success) return;
      const { boardId } = parsed.data;
      socket.leave(roomOf(boardId));
      data.rooms.delete(boardId);
      await broadcastPresence(io, boardId);
    });

    socket.on('disconnect', () => {
      // Presence РІРѕ РІСЃРµС… РєРѕРјРЅР°С‚Р°С… СЃРѕРєРµС‚Р° РѕР±РЅРѕРІРёС‚СЃСЏ (FR-14)
      for (const boardId of data.rooms) {
        void broadcastPresence(io, boardId);
      }
      data.rooms.clear();
    });
  });
}
