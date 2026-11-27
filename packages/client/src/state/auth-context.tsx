import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { RegisterInput, UserDto } from '@task-board/shared';
import * as authApi from '../api/auth';
import { ApiClientError } from '../api/http';

type AuthValue = {
  user: UserDto | null;
  loading: boolean;
  /** Включено ли подтверждение email на сервере (FR-52). */
  emailVerificationRequired: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

/**
 * user: null без ошибки — тихий 401 для анонима (10.2).
 * refresh(): перечитывает пользователя, например после смены имени в профиле.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await authApi.me();
      setUser(res.user);
      setEmailVerificationRequired(Boolean(res.emailVerificationRequired));
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    authApi
      .me()
      .then((res) => {
        setUser(res.user);
        setEmailVerificationRequired(Boolean(res.emailVerificationRequired));
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value: AuthValue = {
    user,
    loading,
    emailVerificationRequired,
    refresh,
    login: async (email, password) => {
      const res = await authApi.login({ email, password });
      setUser(res.user);
      setEmailVerificationRequired(Boolean(res.emailVerificationRequired));
    },
    register: async (input) => {
      const res = await authApi.register(input);
      setUser(res.user);
      setEmailVerificationRequired(Boolean(res.emailVerificationRequired));
    },
    logout: async () => {
      try {
        await authApi.logout();
      } finally {
        setUser(null);
      }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth можно вызывать только внутри <AuthProvider>');
  }
  return ctx;
}

/** Сообщение формы: preferен server-side текст (уже на русском). */
export function errorText(err: unknown): string {
  return err instanceof ApiClientError ? err.message : 'Что-то пошло не так. Попробуйте ещё раз.';
}
