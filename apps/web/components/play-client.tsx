'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { getPuzzleTypeCopy } from '../lib/play-utils.mjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface DisplayItem {
  id: string;
  label: string;
}

interface RunState {
  id: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
  quest: { slug: string; title: string; summary: string; category: string };
  progress: { completedPuzzles: number; totalPuzzles: number; percent: number };
  currentLevel: { orderNo: number; title: string; intro: string } | null;
  currentPuzzle: {
    id: string;
    type: string;
    prompt: string;
    options: DisplayItem[];
    items: DisplayItem[];
    placeholder: string | null;
    unit: string | null;
    hints: string[];
    attemptsMade: number;
    attemptsRemaining: number;
    maxAttempts: number;
    latestAttempt: { isCorrect: boolean; feedback: string; attemptsRemaining: number } | null;
  } | null;
  result: {
    success: boolean;
    score: number;
    attempts: number;
    completedAt: string | null;
    rewards: { xp: number; coins: number; firstCompletion: boolean };
  } | null;
}


export function PlayClient({ runId }: { runId: string }) {
  const router = useRouter();
  const [run, setRun] = useState<RunState | null>(null);
  const [selectedOption, setSelectedOption] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [inputAnswer, setInputAnswer] = useState('');
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [visibleHints, setVisibleHints] = useState(0);
  const attemptIdRef = useRef<string | null>(null);

  const loadRun = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/runs/${runId}`, {
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
      const nextRun = data as RunState;
      setRun(nextRun);
      setSelectedOption('');
      setSelectedOptions([]);
      setInputAnswer('');
      setOrderedIds(
        nextRun.currentPuzzle?.type === 'ordering'
          ? nextRun.currentPuzzle.items.map((item) => item.id)
          : [],
      );
      setVisibleHints(0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Сервер временно недоступен.');
    } finally {
      setLoading(false);
    }
  }, [router, runId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadRun();
    });
  }, [loadRun]);

  function buildAnswer() {
    const puzzle = run?.currentPuzzle;
    if (!puzzle) return null;

    switch (puzzle.type) {
      case 'single_choice':
        return { optionId: selectedOption };
      case 'multiple_choice':
        return { optionIds: selectedOptions };
      case 'numeric_input':
        return { value: inputAnswer };
      case 'text_input':
        return { text: inputAnswer };
      case 'ordering':
        return { orderedIds };
      default:
        return null;
    }
  }

  function canSubmit() {
    const puzzle = run?.currentPuzzle;
    if (!puzzle) return false;

    switch (puzzle.type) {
      case 'single_choice':
        return selectedOption.length > 0;
      case 'multiple_choice':
        return selectedOptions.length > 0;
      case 'numeric_input':
      case 'text_input':
        return inputAnswer.trim().length > 0;
      case 'ordering':
        return puzzle.items.length > 1 && orderedIds.length === puzzle.items.length;
      default:
        return false;
    }
  }

  async function submitAnswer() {
    if (!run?.currentPuzzle || !canSubmit() || submitting) return;
    const answer = buildAnswer();
    if (!answer) return;

    setSubmitting(true);
    setError('');
    if (!attemptIdRef.current) attemptIdRef.current = crypto.randomUUID();

    try {
      const response = await fetch(
        `/api/v1/runs/${run.id}/puzzles/${run.currentPuzzle.id}/attempts`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attemptId: attemptIdRef.current, answer }),
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

  function handlePuzzleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitAnswer();
  }

  function toggleOption(optionId: string) {
    attemptIdRef.current = null;
    setSelectedOptions((current) => current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId]);
  }

  function moveItem(index: number, direction: -1 | 1) {
    attemptIdRef.current = null;
    setOrderedIds((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  async function restartQuest() {
    if (!run) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/runs`, {
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
    return (
      <main className="play-page">
        <Link className="brand game-brand" href="/">
          <span className="brand-mark">Q</span><span>questoria</span>
        </Link>
        <section className="game-card game-loading-card" aria-busy="true" aria-live="polite">
          <span className="game-loading-mark" aria-hidden="true">✦</span>
          <p className="eyebrow">ГОТОВИМ ПРИКЛЮЧЕНИЕ</p>
          <h1>Загружаем твою миссию…</h1>
          <div className="game-loading-line" aria-hidden="true"><span /></div>
          <p className="muted-copy">Загрузка задания и твоего сохранённого прогресса</p>
        </section>
      </main>
    );
  }

  if (!run) {
    return (
      <main className="play-page">
        <Link className="brand game-brand" href="/">
          <span className="brand-mark">Q</span><span>questoria</span>
        </Link>
        <section className="game-card">
          <p className="eyebrow">НЕ УДАЛОСЬ ЗАГРУЗИТЬ</p>
          <h1>Миссия пока недоступна</h1>
          <p>{error || 'Проверь подключение и попробуй ещё раз.'}</p>
          <button className="button button-primary" onClick={() => void loadRun(true)} type="button">
            Повторить загрузку
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
          <div className="result-symbol" aria-hidden="true">{run.result?.success ? '✦' : '↻'}</div>
          <p className="eyebrow">{run.result?.success ? 'МИССИЯ ВЫПОЛНЕНА' : run.status === 'ABANDONED' ? 'ПРОХОЖДЕНИЕ ОСТАНОВЛЕНО' : 'ПОПЫТКА ЗАВЕРШЕНА'}</p>
          <h1>{run.result?.success ? 'Отличная работа!' : 'Исследование продолжается'}</h1>
          <p className="muted-copy">
            {run.result?.success
              ? `Ты завершил миссию «${run.quest.title}». Результат и заслуженные награды сохранены в профиле.`
              : `Прохождение миссии «${run.quest.title}» завершено. Ошибки помогают понять, что стоит попробовать иначе. Выбери новую попытку или другую миссию.`}
          </p>
          <div className="result-stats">
            <div><strong>{run.result?.score ?? 0}</strong><span>баллов</span></div>
            <div><strong>{run.result?.attempts ?? 0}</strong><span>попыток</span></div>
            <div className="reward-stat"><strong>+{run.result?.rewards.xp ?? 0}</strong><span>XP</span></div>
            <div className="reward-stat"><strong>+{run.result?.rewards.coins ?? 0}</strong><span>монет</span></div>
          </div>
          {run.result?.rewards.firstCompletion ? (
            <p className="result-reward-note">Награда за первое прохождение начислена в твой профиль.</p>
          ) : run.result ? (
            <p className="small-note">Повторное прохождение не приносит дополнительные монеты и XP за эту версию миссии.</p>
          ) : null}
          <div className="result-actions">
            <button className="button button-primary" disabled={submitting} onClick={restartQuest} type="button">
              {submitting ? 'Готовим…' : 'Пройти ещё раз'}
            </button>
            <Link className="text-link" href="/profile">Мой профиль →</Link>
          </div>
          <Link className="text-link result-back" href="/quests">Вернуться в каталог</Link>
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  const puzzle = run.currentPuzzle;
  const orderedItems = puzzle?.type === 'ordering'
    ? orderedIds.flatMap((id) => {
      const item = puzzle.items.find((candidate) => candidate.id === id);
      return item ? [item] : [];
    })
    : [];

  return (
    <main className="play-page">
      <header className="game-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">Q</span><span>questoria</span>
        </Link>
        <Link className="simple-nav-link" href="/quests">Выйти из миссии</Link>
      </header>
      <div className="game-progress game-progress-header">
        <div><span>МИССИЯ · {run.quest.category.toUpperCase()}</span><strong>{run.progress.percent}%</strong></div>
        <div className="game-progress-track" role="progressbar" aria-valuenow={run.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${run.progress.completedPuzzles} из ${run.progress.totalPuzzles} заданий`} aria-label="Прогресс миссии"><span style={{ width: `${run.progress.percent}%` }} /></div>
        <small>Задание {Math.min(run.progress.completedPuzzles + 1, run.progress.totalPuzzles)} из {run.progress.totalPuzzles} · этап {run.currentLevel?.orderNo ?? 1}</small>
      </div>
      <section className="game-card">
        <p className="eyebrow">{run.quest.title}</p>
        <h1>{run.currentLevel?.title ?? 'Продолжение миссии'}</h1>
        <p className="game-intro">{run.currentLevel?.intro ?? run.quest.summary}</p>
        {puzzle ? (
          <form className="puzzle-panel" onSubmit={handlePuzzleSubmit} aria-busy={submitting}>
            <div className="puzzle-counter">
              <span>{getPuzzleTypeCopy(puzzle.type).label}</span>
              <span>Попыток осталось: {puzzle.attemptsRemaining} из {puzzle.maxAttempts}</span>
            </div>
            <h2 id="current-puzzle-prompt">{puzzle.prompt}</h2>
            <p className="game-puzzle-guidance">{getPuzzleTypeCopy(puzzle.type).instruction}</p>
            {!['single_choice', 'multiple_choice', 'numeric_input', 'text_input', 'ordering'].includes(puzzle.type) && (
              <div className="feedback feedback-error" role="alert">Этот формат задания пока не поддерживается. Вернись в каталог и выбери другую миссию.</div>
            )}

            {puzzle.type === 'single_choice' && (
              <div className="answer-options" role="group" aria-label="Варианты ответа">
                {puzzle.options.map((option) => (
                  <button
                    className={selectedOption === option.id ? 'answer-option selected' : 'answer-option'}
                    key={option.id}
                    onClick={() => { attemptIdRef.current = null; setSelectedOption(option.id); }}
                    aria-pressed={selectedOption === option.id}
                    disabled={submitting}
                    type="button"
                  >
                    <span className="radio-indicator" />
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            {puzzle.type === 'multiple_choice' && (
              <div className="answer-options" role="group" aria-label="Выбери все подходящие варианты">
                {puzzle.options.map((option) => (
                  <label className="answer-checkbox" key={option.id}>
                    <input
                      type="checkbox"
                      checked={selectedOptions.includes(option.id)}
                      onChange={() => toggleOption(option.id)}
                      disabled={submitting}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            )}

            {puzzle.type === 'numeric_input' && (
              <label className="answer-input-wrap">
                <span className="answer-input-label">Твой ответ{puzzle.unit ? ` (${puzzle.unit})` : ''}</span>
                <input
                  className="answer-input"
                  type="text"
                  inputMode="decimal"
                  maxLength={64}
                  required
                  disabled={submitting}
                  value={inputAnswer}
                  placeholder={puzzle.placeholder ?? 'Введи число'}
                  onChange={(event) => { attemptIdRef.current = null; setInputAnswer(event.target.value); }}
                />
              </label>
            )}

            {puzzle.type === 'text_input' && (
              <label className="answer-input-wrap">
                <span className="answer-input-label">Твой ответ</span>
                <input
                  className="answer-input"
                  type="text"
                  maxLength={2000}
                  required
                  disabled={submitting}
                  value={inputAnswer}
                  placeholder={puzzle.placeholder ?? 'Введи ответ'}
                  onChange={(event) => { attemptIdRef.current = null; setInputAnswer(event.target.value); }}
                />
              </label>
            )}

            {puzzle.type === 'ordering' && (
              <div className="ordering-list" aria-label="Упорядочи элементы">
                {orderedItems.map((item, index) => (
                  <div className="ordering-row" key={item.id}>
                    <span className="ordering-index">{index + 1}</span>
                    <span className="ordering-label">{item.label}</span>
                    <div className="ordering-controls">
                      <button
                        className="order-move-button"
                        type="button"
                        aria-label={`Переместить ${item.label} выше`}
                        disabled={index === 0 || submitting}
                        onClick={() => moveItem(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="order-move-button"
                        type="button"
                        aria-label={`Переместить ${item.label} ниже`}
                        disabled={index === orderedItems.length - 1 || submitting}
                        onClick={() => moveItem(index, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {puzzle.latestAttempt && (
              <div
                className={puzzle.latestAttempt.isCorrect ? 'feedback feedback-success' : 'feedback feedback-error'}
                role="status"
                aria-live="polite"
              >
                <strong>{puzzle.latestAttempt.isCorrect ? 'Верно!' : 'Попробуй ещё раз'}</strong>
                <span>{puzzle.latestAttempt.feedback}</span>
              </div>
            )}
            {visibleHints > 0 && (
              <div className="hint-panel" role="status" aria-live="polite">
                <strong>Подсказка {visibleHints} из {puzzle.hints.length}</strong>
                {puzzle.hints.slice(0, visibleHints).map((hint, index) => <p key={index}>{hint}</p>)}
              </div>
            )}
            <div className="game-actions">
              <button className="button button-secondary" disabled={submitting || puzzle.hints.length === 0 || visibleHints >= puzzle.hints.length} onClick={() => setVisibleHints((value) => Math.min(value + 1, puzzle.hints.length))} type="button">
                {visibleHints >= puzzle.hints.length ? 'Все подсказки открыты' : visibleHints ? 'Следующая подсказка' : 'Получить подсказку'}
              </button>
              <button
                className="button button-primary"
                disabled={!canSubmit() || submitting || puzzle.attemptsRemaining === 0}
                type="submit"
              >
                {submitting ? 'Проверяем…' : 'Проверить ответ'}
              </button>
            </div>
          </form>
        ) : (
          <div className="feedback feedback-error" role="alert">
            <strong>Не удалось определить активное задание.</strong>
            <span>Обнови данные прохождения. Твой серверный прогресс останется сохранённым.</span>
            <button className="button button-secondary" onClick={() => void loadRun(true)} type="button">Обновить задание</button>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
