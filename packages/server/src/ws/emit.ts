// Socket.IO: доступ к экземпляру io из HTTP-слоя (для broadcast'ов и disconnect из REST).
// Регистрируется один раз при старте сервера.

interface Emitter {
  to(room: string): { emit(event: string, payload: unknown): unknown };
  in(room: string): { disconnectSockets(close: boolean): void };
}

let ioRef: Emitter | null = null;

export function setIo(io: Emitter): void {
  ioRef = io;
}

const boardRoom = (boardId: string) => `board:${boardId}`;

/** Личная комната пользователя: все его сокеты во всех вкладках/устройствах. */
export const userRoom = (userId: string) => `user:${userId}`;

/** Рассылка события всем, кто сейчас в комнате доски. */
export function emitToBoard(boardId: string, event: string, payload: unknown): void {
  ioRef?.to(boardRoom(boardId)).emit(event, payload);
}

/**
 * Разрывает все сокеты пользователя. Нужно при выходе/смене пароля/«выйти везде»:
 * сокет аутентифицируется только в handshake, поэтому после смены аккаунта он
 * продолжал работать от имени прежнего пользователя (VIEWER мог редактировать).
 * Клиент переподключится сам — уже с актуальной cookie.
 */
export function disconnectUser(userId: string): void {
  ioRef?.in(userRoom(userId)).disconnectSockets(true);
}
