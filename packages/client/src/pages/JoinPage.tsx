import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { joinByToken } from '../api/boards';
import { errorText } from '../state/auth-context';

type Status = 'joining' | 'need-auth' | 'joined' | 'error';

/** Вступление по invite-ссылке (FR-15): неавторизованного ведём на логин с возвратом. */
export function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const [status, setStatus] = useState<Status>('joining');
  const [boardTitle, setBoardTitle] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const from = encodeURIComponent(location.pathname + location.search);

  useEffect(() => {
    if (!token || status !== 'joining') return;
    let cancelled = false;
    joinByToken(token)
      .then((res) => {
        if (cancelled) return;
        setBoardTitle(res.boardTitle);
        setBoardId(res.boardId);
        setStatus('joined');
      })
      .catch((err) => {
        if (cancelled) return;
        const message = errorText(err);
        if (message.includes('Войдите')) {
          setStatus('need-auth');
        } else {
          setMessage(message);
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, status]);

  if (status === 'joining') {
    return (
      <main className="page">
        <p className="empty">Присоединяемся к доске…</p>
      </main>
    );
  }

  if (status === 'need-auth') {
    return (
      <main className="page">
        <h1>Приглашение на доску</h1>
        <p>Чтобы присоединиться, войдите или зарегистрируйтесь — после этого вы вернётесь на доску.</p>
        <div className="modal-actions">
          <Link className="btn-as-link" to={`/login?next=${from}`}>
            Войти
          </Link>
          <Link className="btn-as-link" to={`/register?next=${from}`}>
            Зарегистрироваться
          </Link>
        </div>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="page">
        <p className="error">{message}</p>
        <Link to="/boards">К списку досок</Link>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Вы присоединились к доске «{boardTitle}»</h1>
      <p>
        <Link to={`/boards/${boardId}`}>Открыть доску</Link>
      </p>
    </main>
  );
}
