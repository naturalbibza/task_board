import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { BoardDto } from '@task-board/shared';
import * as boardsApi from '../api/boards';
import { errorText, useAuth } from '../state/auth-context';

export function BoardsPage() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [boards, setBoards] = useState<BoardDto[] | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    boardsApi
      .listBoards()
      .then((res) => setBoards(res.boards))
      .catch((err) => setError(errorText(err)));
  }, []);

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  if (loading) {
    return (
      <main className="page" aria-busy="true">
        <div className="skeleton skeleton-bar" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line skeleton-short" />
      </main>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  const onCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setError(null);
    try {
      const res = await boardsApi.createBoard(title);
      setNewTitle('');
      navigate(`/boards/${res.board.id}`);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const onDelete = async (board: BoardDto) => {
    if (!window.confirm(`Удалить доску «${board.title}»?`)) return;
    try {
      await boardsApi.deleteBoard(board.id);
      reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <main className="page">
      <header className="page-header">
        <h1>Мои доски</h1>
        <span>
          {user.name}{' '}
          <button type="button" className="link" onClick={() => void logout()}>
            Выйти
          </button>
        </span>
      </header>

      {error && <p className="error">{error}</p>}

      <form
        className="board-create"
        onSubmit={(e) => {
          e.preventDefault();
          void onCreate();
        }}
      >
        <input
          type="text"
          placeholder="Название новой доски"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          maxLength={100}
        />
        <button type="submit">Создать доску</button>
      </form>

      {boards === null ? (
        <ul className="board-list" aria-busy="true">
          <li className="card board-item">
            <div className="skeleton skeleton-line" />
          </li>
          <li className="card board-item">
            <div className="skeleton skeleton-line skeleton-short" />
          </li>
        </ul>
      ) : boards.length === 0 ? (
        <p className="empty">У вас пока нет досок. Создайте первую выше.</p>
      ) : (
        <ul className="board-list">
          {boards.map((board) => (
            <li key={board.id} className="card board-item">
              <button type="button" className="board-link" onClick={() => navigate(`/boards/${board.id}`)}>
                {board.title}
              </button>
              <span className="board-meta">
                {board.role === 'OWNER' ? 'владелец' : 'участник'}
                {board.role === 'OWNER' && (
                  <button type="button" className="link danger" onClick={() => void onDelete(board)}>
                    удалить
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
