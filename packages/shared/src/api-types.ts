import { z } from 'zod';

// --- Auth (фаза 1) ---

export const registerSchema = z.object({
  email: z.email('Некорректный email'),
  password: z.string().min(8, 'Пароль должен быть не короче 8 символов'),
  name: z.string().min(1).max(50).optional(),
});

export const loginSchema = z.object({
  email: z.email('Некорректный email'),
  password: z.string().min(1, 'Введите пароль'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/** Пользователь без приватных полей — то, что сервер отдаёт клиенту. */
export type UserDto = {
  id: string;
  email: string;
  name: string;
};

// --- Доски и контент (фаза 5) ---

export type BoardDto = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  role: 'OWNER' | 'MEMBER';
};

export type ColumnDto = {
  id: string;
  boardId: string;
  title: string;
  position: number;
};

export type CardDto = {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  authorId: string;
  createdAt: string;
  updatedAt: string;
};

/** Полный снапшот доски — отдаётся при открытии доски (FR-9: тот же на WS). */
export type BoardSnapshot = {
  board: BoardDto;
  columns: ColumnDto[];
  cards: CardDto[];
  members: UserDto[];
};

export const createBoardSchema = z.object({
  title: z.string().min(1, 'Введите название').max(100, 'Не длиннее 100 символов'),
});

export const renameBoardSchema = createBoardSchema;

export const createColumnSchema = z.object({
  title: z.string().min(1, 'Введите название').max(100, 'Не длиннее 100 символов'),
});

export const createCardSchema = z.object({
  title: z.string().min(1, 'Введите заголовок').max(200, 'Не длиннее 200 символов'),
  description: z.string().max(5000, 'Не длиннее 5000 символов').optional(),
});

export const updateCardSchema = z.object({
  title: z.string().min(1, 'Заголовок не может быть пустым').max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
});

// --- Общие контрактные типы (NFR-8: единый формат ошибок) ---

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};
