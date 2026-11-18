'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { selectActiveRuns, type ActiveQuestRun } from '../lib/resume-utils.mjs';

type LoadState = 'loading' | 'hidden' | 'ready' | 'error';

function formatActivityDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function ContinueLearning() {
  const [runs, setRuns] = useState<ActiveQuestRun[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadActiveRuns() {
      setState('loading');

      try {
        const response = await fetch('/api/v1/me/progress', {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });

        if (response.status === 401) {
          setState('hidden');
          return;
        }
        if (!response.ok) {
          throw new Error('Progress request failed.');
        }

        const data: unknown = await response.json();
        const recentRuns = (
          data && typeof data === 'object' && 'recentRuns' in data
            ? data.recentRuns
            : undefined
        );
        setRuns(selectActiveRuns(recentRuns));
        setState('ready');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }

    void loadActiveRuns();
    return () => controller.abort();
  }, [retryCount]);

  if (state === 'loading' || state === 'hidden') return null;

  if (state === 'error') {
    return (
      <section className="continue-learning-error" aria-label="Продолжение миссий">
        <p>Не удалось проверить незавершённые миссии.</p>
        <button type="button" onClick={() => setRetryCount((count) => count + 1)}>
          Повторить
        </button>
      </section>
    );
  }

  if (!runs.length) return null;

  return (
    <section className="continue-learning" aria-labelledby="continue-learning-title">
      <div className="continue-learning-heading">
        <div>
          <p className="eyebrow">ТВОЙ ПУТЬ ИССЛЕДОВАТЕЛЯ</p>
          <h2 id="continue-learning-title">Продолжить миссию</h2>
          <p>Твой прогресс сохранён — возвращайся с того же места.</p>
        </div>
        <Link className="continue-profile-link" href="/profile">
          Весь прогресс <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="continue-learning-grid">
        {runs.map((run) => {
          const activityDate = formatActivityDate(run.lastActivityAt);
          return (
            <Link
              className="continue-quest-card"
              href={'/play/' + encodeURIComponent(run.id)}
              key={run.id}
              aria-label={'Продолжить миссию «' + run.title + '»'}
            >
              <span className="continue-quest-icon" aria-hidden="true">↗</span>
              <span className="continue-quest-copy">
                <span className="continue-quest-kicker">НЕЗАВЕРШЁННАЯ МИССИЯ</span>
                <strong>{run.title}</strong>
                <span className="continue-quest-meta">
                  Этапов пройдено: {run.completedLevels} · Баллы: {run.score}
                  {activityDate ? ' · ' + activityDate : ''}
                </span>
              </span>
              <span className="continue-quest-action">
                Продолжить <span aria-hidden="true">→</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
