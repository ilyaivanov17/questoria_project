'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface StartQuestButtonProps {
  slug: string;
}

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function StartQuestButton({ slug }: StartQuestButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function startQuest() {
    setBusy(true);
    setError('');

    try {
      const response = await fetch(`${apiBase}/api/v1/runs`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });

      if (response.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/quests/${slug}`)}`);
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? data.error?.message ?? 'Не удалось начать квест.');
      }

      router.push(`/play/${data.id}`);
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : 'Сервер временно недоступен.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="start-action">
      <button className="button button-primary" onClick={startQuest} disabled={busy} type="button">
        {busy ? 'Открываем миссию…' : 'Начать квест'}
        <span aria-hidden="true">→</span>
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
