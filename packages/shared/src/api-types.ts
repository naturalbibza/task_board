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

// --- Общие контрактные типы (NFR-8: единый формат ошибок) ---

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};
