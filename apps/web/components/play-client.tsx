'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface RunState {
  id: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
  quest: { slug: string; title: string; summary: string; category: string };
  currentLevel: { orderNo: number; title: string; intro: string } | null;
  currentPuzzle: {
    id: string;
    type: string;
    prompt: string;
    options: Array<{ id: string; label: string }>;
    hints: string[];
    attemptsMade: number;
    attemptsRemaining: number;
    maxAttempts: number;
    latestAttempt: { isCorrect: boolean; feedback: string; attemptsRemaining: number } | null;
  } | null;
  result: { success: boolean; score: number; attempts: number; completedAt: string | null } | null;
}

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function PlayClient({ runId }: { runId: string }) {
  const router = useRouter();
  const [run, setRun] = useState<RunState | null>(null);
  const [selectedOption, setSelectedOption] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showHint, setShowHint] = useState(false);
  const attemptIdRef = useRef<string | null>(null);

  const loadRun = useCallback(async () => {
    setError('');
    try {
      const response = await fetch(`${apiBase}/api/v1/runs/${runId}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(`/play/${runId}`)}`);
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? data.error?.message ?? 'Не удалось загрузить прохождение.');
      }
      setRun(data as RunState);
      setSelectedOption('');
      setShowHint(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Сервер временно недоступен.');
    } finally {
      setLoading(false);
    }
  }, [router, runId]);

  useEffect(() => {
    void loadRun();
  }, [loadRun]);

  async function submitAnswer() {
    if (!run?.currentPuzzle || !selectedOption || submitting) return;
    setSubmitting(true);
    setError('');
    if (!attemptIdRef.current) attemptIdRef.current = crypto.randomUUID();

    try {
      const response = await fetch(
        `${apiBase}/api/v1/runs/${run.id}/puzzles/${run.currentPuzzle.id}/attempts`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attemptId: attemptIdRef.current,
            answer: { optionId: selectedOption },
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? data.error?.message ?? 'Не удалось проверить ответ.');
      }
      attemptIdRef.current = null;
      await loadRun();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось отправить ответ.');
    } finally {
      setSubmitting(false);
    }
  }

  async function restartQuest() {
    if (!run) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/api/v1/runs`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: run.quest.slug }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? data.error?.message ?? 'Не удалось начать заново.');
      }
      router.replace(`/play/${data.id}`);
      router.refresh();
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : 'Не удалось начать квест.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <main className="play-page"><p className="muted-copy">Загружаем твою миссию…</p></main>;
  }

  if (!run) {
    return (
      <main className="play-page">
        <section className="game-card">
          <p className="eyebrow">НЕ УДАЛОСЬ ЗАГРУЗИТЬ</p>
          <h1>Миссия пока недоступна</h1>
          <p>{error || 'Проверь подключение и попробуй ещё раз.'}</p>
          <button className="button button-primary" onClick={() => void loadRun()} type="button">
            Повторить
          </button>
        </section>
      </main>
    );
  }

  if (run.status !== 'IN_PROGRESS') {
    return (
      <main className="play-page">
        <Link className="brand game-brand" href="/">
          <span className="brand-mark">Q</span><span>questoria</span>
        </Link>
        <section className="result-card">
          <div className="result-symbol">{run.result?.success ? '✦' : '↻'}</div>
          <p className="eyebrow">{run.result?.success ? 'МИССИЯ ВЫПОЛНЕНА' : 'ПОПЫТКИ ЗАВЕРШЕНЫ'}</p>
          <h1>{run.result?.success ? 'Отличная работа!' : 'Это часть исследования'}</h1>
          <p className="muted-copy">
            {run.result?.success
              ? 'Ты нашёл закономерность и открыл шифрованную дверь.'
              : 'Не каждую загадку удаётся решить с первого раза. Теперь ты знаешь, на что обратить внимание.'}
          </p>
          <div className="result-stats">
            <div><strong>{run.result?.score ?? 0}</strong><span>баллов</span></div>
            <div><strong>{run.result?.attempts ?? 0}</strong><span>попыток</span></div>
          </div>
          <button className="button button-primary" disabled={submitting} onClick={restartQuest} type="button">
            {submitting ? 'Готовим…' : 'Пройти ещё раз'}
          </button>
          <Link className="text-link result-back" href="/quests">Вернуться в каталог</Link>
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  const puzzle = run.currentPuzzle;

  return (
    <main className="play-page">
      <header className="game-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">Q</span><span>questoria</span>
        </Link>
        <Link className="simple-nav-link" href="/quests">Выйти из миссии</Link>
      </header>
      <div className="game-progress">
        <span>МИССИЯ · {run.quest.category.toUpperCase()}</span>
        <span>ЭТАП {run.currentLevel?.orderNo ?? 1}</span>
      </div>
      <section className="game-card">
        <p className="eyebrow">{run.quest.title}</p>
        <h1>{run.currentLevel?.title ?? 'Продолжение миссии'}</h1>
        <p className="game-intro">{run.currentLevel?.intro ?? run.quest.summary}</p>
        {puzzle ? (
          <div className="puzzle-panel">
            <div className="puzzle-counter">
              <span>ЛОГИЧЕСКАЯ ЗАДАЧА</span>
              <span>Осталось попыток: {puzzle.attemptsRemaining}</span>
            </div>
            <h2>{puzzle.prompt}</h2>
            <div className="answer-options" role="radiogroup" aria-label="Варианты ответа">
              {puzzle.options.map((option) => (
                <button
                  className={selectedOption === option.id ? 'answer-option selected' : 'answer-option'}
                  key={option.id}
                  onClick={() => setSelectedOption(option.id)}
                  role="radio"
                  aria-checked={selectedOption === option.id}
                  type="button"
                >
                  <span className="radio-indicator" />
                  {option.label}
                </button>
              ))}
            </div>
            {puzzle.latestAttempt && (
              <div className={puzzle.latestAttempt.isCorrect ? 'feedback feedback-success' : 'feedback feedback-error'}>
                {puzzle.latestAttempt.feedback}
              </div>
            )}
            {showHint && puzzle.hints[0] && (
              <div className="hint-panel"><strong>Подсказка</strong><p>{puzzle.hints[0]}</p></div>
            )}
            <div className="game-actions">
              <button className="button button-secondary" onClick={() => setShowHint((value) => !value)} type="button">
                {showHint ? 'Скрыть подсказку' : 'Получить подсказку'}
              </button>
              <button
                className="button button-primary"
                disabled={!selectedOption || submitting || puzzle.attemptsRemaining === 0}
                onClick={submitAnswer}
                type="button"
              >
                {submitting ? 'Проверяем…' : 'Проверить ответ'}
              </button>
            </div>
          </div>
        ) : (
          <div className="feedback feedback-error">
            Не удалось определить активное задание. Обнови страницу или вернись в каталог.
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
