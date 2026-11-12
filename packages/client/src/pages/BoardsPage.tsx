import { Navigate } from 'react-router-dom';
import { useAuth } from '../state/auth-context';

export function BoardsPage() {
  const { user, loading, logout } = useAuth();

  if (loading) return <main className="page">Загрузка…</main>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <main className="page">
      <header className="page-header">
        <h1>Мои доски</h1>
        <span>
          {user.name} <button type="button" className="link" onClick={() => void logout()}>Выйти</button>
        </span>
      </header>
      <p className="empty">У вас пока нет досок.</p>
      <button type="button" disabled title="Создание досок появится в фазе 3">
        Создать доску
      </button>
    </main>
  );
}
