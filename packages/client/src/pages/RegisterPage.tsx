import { useState, type FormEvent } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { errorText, useAuth } from '../state/auth-context';

export function RegisterPage() {
  const { user, loading, register } = useAuth();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/boards" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({ email, password, name: name.trim() || undefined });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="card form" onSubmit={onSubmit}>
        <h1>Регистрация</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Имя <span className="optional">(необязательно)</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        </label>
        <label>
          Пароль <span className="optional">(минимум 8 символов)</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Регистрируем…' : 'Создать аккаунт'}
        </button>
        <p className="hint">
          Уже есть аккаунт? <Link to="/login">Войдите</Link>
        </p>
      </form>
    </main>
  );
}
