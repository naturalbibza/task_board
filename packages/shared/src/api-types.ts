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
  /** Подтверждён ли email (v2, фаза 14): false — ограниченный режим (FR-32). */
  emailVerified: boolean;
};

// --- Доски и контент (фаза 5) ---

/** Роль участника на доске (v2). Права — см. packages/shared/src/permissions.ts. */
export type BoardRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

export type BoardDto = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  role: BoardRole;
};

/** Участник доски с ролью и контактами (v2). Контакты видят только участники доски. */
export type MemberDto = {
  id: string;
  name: string;
  email: string;
  role: BoardRole;
  description: string | null;
  phone: string | null;
  messengers: MessengerContact[];
};

/** Контакт в мессенджере (FR-28): тип + значение, всё опционально. */
export type MessengerType = 'telegram' | 'whatsapp' | 'other';

export type MessengerContact = {
  type: MessengerType;
  value: string;
};

/** Профиль в личном кабинете (FR-28). */
export type UserProfileDto = {
  id: string;
  email: string;
  name: string;
  description: string | null;
  phone: string | null;
  messengers: MessengerContact[];
  createdAt: string;
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
  members: MemberDto[];
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

// --- Доступы (v2, фаза 12) ---

/** Смена роли участника: владелец может назначать ADMIN, админ — только ниже себя. */
export const updateMemberSchema = z.object({
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER'], { message: 'Некорректная роль' }),
});

/** Роль, с которой можно вступить по ссылке (OWNER не выдаётся никогда). */
export const inviteRoleSchema = z.enum(['ADMIN', 'EDITOR', 'VIEWER']);

export const createInviteSchema = z.object({
  role: inviteRoleSchema.optional(),
  // Приглашение на конкретный адрес (FR-26): вступить сможет только он
  email: z.email('Некорректный email').optional(),
});

export type InviteDto = {
  id: string;
  token: string;
  expiresAt: string;
  revoked: boolean;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
  /** Приглашение на конкретный адрес (v2, FR-26). */
  email: string | null;
};

/** Подтверждение email по токену из письма (v2, фаза 14). */
export const verifyEmailSchema = z.object({
  token: z.string().min(16, 'Некорректная ссылка'),
});

// --- Аккаунт (v2, фаза 13) ---

export const messengerTypeSchema = z.enum(['telegram', 'whatsapp', 'other']);

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Имя не может быть пустым').max(50, 'Не длиннее 50 символов').optional(),
  description: z.string().max(500, 'Не длиннее 500 символов').nullable().optional(),
  phone: z.string().max(50, 'Не длиннее 50 символов').nullable().optional(),
  messengers: z
    .array(
      z.object({
        type: messengerTypeSchema,
        value: z.string().trim().min(1, 'Укажите контакт').max(100, 'Не длиннее 100 символов'),
      }),
    )
    .max(5, 'Не больше 5 контактов')
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль'),
  newPassword: z.string().min(8, 'Пароль должен быть не короче 8 символов'),
});

// --- Общие контрактные типы (NFR-8: единый формат ошибок) ---

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};
