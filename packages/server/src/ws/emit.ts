// Socket.IO: доступ к экземпляру io из HTTP-слоя (для broadcast'ов из REST).
// Регистрируется один раз при старте сервера.

interface Emitter {
  to(room: string): { emit(event: string, payload: unknown): unknown };
}

let ioRef: Emitter | null = null;

export function setIo(io: Emitter): void {
  ioRef = io;
}

const roomOf = (boardId: string) => `board:${boardId}`;

/** Рассылка события всем, кто сейчас в комнате доски. */
export function emitToBoard(boardId: string, event: string, payload: unknown): void {
  ioRef?.to(roomOf(boardId)).emit(event, payload);
}
