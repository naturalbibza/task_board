import { useEffect, useState } from 'react';

type Health = { status: string; service: string };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <main className="page">
      <h1>Task Board</h1>
      <p>Скелет монорепо (фаза 0).</p>
      <p>
        Сервер:{' '}
        {health ? (
          <code>
            {health.service} — {health.status}
          </code>
        ) : (
          'недоступен'
        )}
      </p>
    </main>
  );
}
