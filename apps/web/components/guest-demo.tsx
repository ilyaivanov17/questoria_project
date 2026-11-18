'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import type {
  PublicQuestDemoAttemptResponse,
  PublicQuestDemoPreviewResponse,
} from '@questoria/contracts';
import { getPuzzleTypeCopy } from '../lib/play-utils.mjs';

type DemoAnswer = Record<string, unknown>;

export function GuestDemo({ slug }: { slug: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<PublicQuestDemoPreviewResponse | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<PublicQuestDemoAttemptResponse | null>(null);
  const [selectedOption, setSelectedOption] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [inputAnswer, setInputAnswer] = useState('');
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [visibleHints, setVisibleHints] = useState(0);

  async function openDemo() {
    setExpanded(true);
    if (preview || loading) return;

    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        '/api/v1/public/quests/' + encodeURIComponent(slug) + '/preview',
        { cache: 'no-store' },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? data.error?.message ?? 'Не удалось загрузить пример задания.');
      }

      const nextPreview = data as PublicQuestDemoPreviewResponse;
      setPreview(nextPreview);
      if (nextPreview.puzzle.type === 'ordering') {
        setOrderedIds(nextPreview.puzzle.items.map((item) => item.id));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Сервер временно недоступен.');
    } finally {
      setLoading(false);
    }
  }

  function buildAnswer(): DemoAnswer | null {
    const type = preview?.puzzle.type;
    switch (type) {
      case 'single_choice':
        return selectedOption ? { optionId: selectedOption } : null;
      case 'multiple_choice':
        return selectedOptions.length ? { optionIds: selectedOptions } : null;
      case 'numeric_input':
        return inputAnswer.trim() ? { value: inputAnswer } : null;
      case 'text_input':
        return inputAnswer.trim() ? { text: inputAnswer } : null;
      case 'ordering':
        return preview.puzzle.items.length > 1
          && orderedIds.length === preview.puzzle.items.length
          ? { orderedIds }
          : null;
      default:
        return null;
    }
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const answer = buildAnswer();
    if (!answer || submitting || feedback?.result === 'correct') return;

    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        '/api/v1/public/quests/' + encodeURIComponent(slug) + '/preview/attempts',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? data.error?.message ?? 'Не удалось проверить ответ.');
      }
      setFeedback(data as PublicQuestDemoAttemptResponse);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось отправить ответ.');
    } finally {
      setSubmitting(false);
    }
  }

  function toggleOption(optionId: string) {
    setFeedback(null);
    setSelectedOptions((current) => current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId]);
  }

  function moveItem(index: number, direction: -1 | 1) {
    setFeedback(null);
    setOrderedIds((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  const puzzle = preview?.puzzle;
  const orderedItems = puzzle?.type === 'ordering'
    ? orderedIds.flatMap((id) => {
      const item = puzzle.items.find((candidate) => candidate.id === id);
      return item ? [item] : [];
    })
    : [];
  const answer = buildAnswer();

  return (
    <section className="guest-demo" aria-labelledby="guest-demo-title">
      <div className="guest-demo-heading">
        <div>
          <p className="eyebrow">СНАЧАЛА ПОПРОБУЙ</p>
          <h2 id="guest-demo-title">Попробовать задание бесплатно</h2>
          <p>Реши один настоящий вопрос из этой миссии — аккаунт пока не нужен.</p>
        </div>
        {!expanded ? (
          <button className="button button-secondary" onClick={() => void openDemo()} type="button">
            Попробовать <span aria-hidden="true">→</span>
          </button>
        ) : (
          <button className="guest-demo-collapse" onClick={() => setExpanded(false)} type="button">
            Свернуть
          </button>
        )}
      </div>

      {expanded ? (
        <div className="guest-demo-body" aria-busy={loading || submitting}>
          {loading ? (
            <p className="guest-demo-status" role="status">Готовим пример задания…</p>
          ) : puzzle ? (
            <>
              <div className="puzzle-counter">
                <span>{getPuzzleTypeCopy(puzzle.type).label}</span>
                <span>Гостевой режим · 1 задание</span>
              </div>
              <h3>{puzzle.prompt}</h3>
              <p className="game-puzzle-guidance">{getPuzzleTypeCopy(puzzle.type).instruction}</p>

              <form className="guest-demo-form" onSubmit={submitAnswer}>
                {puzzle.type === 'single_choice' ? (
                  <div className="answer-options" role="group" aria-label="Варианты ответа">
                    {puzzle.options.map((option) => (
                      <button
                        className={selectedOption === option.id ? 'answer-option selected' : 'answer-option'}
                        key={option.id}
                        onClick={() => { setFeedback(null); setSelectedOption(option.id); }}
                        aria-pressed={selectedOption === option.id}
                        disabled={submitting || feedback?.result === 'correct'}
                        type="button"
                      >
                        <span className="radio-indicator" />
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {puzzle.type === 'multiple_choice' ? (
                  <div className="answer-options" role="group" aria-label="Выбери все подходящие варианты">
                    {puzzle.options.map((option) => (
                      <label className="answer-checkbox" key={option.id}>
                        <input
                          type="checkbox"
                          checked={selectedOptions.includes(option.id)}
                          onChange={() => toggleOption(option.id)}
                          disabled={submitting || feedback?.result === 'correct'}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                ) : null}

                {puzzle.type === 'numeric_input' || puzzle.type === 'text_input' ? (
                  <label className="answer-input-wrap">
                    <span className="answer-input-label">
                      {puzzle.type === 'numeric_input' && puzzle.unit
                        ? 'Твой ответ (' + puzzle.unit + ')'
                        : 'Твой ответ'}
                    </span>
                    <input
                      className="answer-input"
                      type="text"
                      inputMode={puzzle.type === 'numeric_input' ? 'decimal' : 'text'}
                      maxLength={puzzle.type === 'numeric_input' ? 64 : 2000}
                      required
                      disabled={submitting || feedback?.result === 'correct'}
                      value={inputAnswer}
                      placeholder={puzzle.placeholder ?? (puzzle.type === 'numeric_input' ? 'Введи число' : 'Введи ответ')}
                      onChange={(event) => { setFeedback(null); setInputAnswer(event.target.value); }}
                    />
                  </label>
                ) : null}

                {puzzle.type === 'ordering' ? (
                  <div className="ordering-list" aria-label="Упорядочи элементы">
                    {orderedItems.map((item, index) => (
                      <div className="ordering-row" key={item.id}>
                        <span className="ordering-index">{index + 1}</span>
                        <span className="ordering-label">{item.label}</span>
                        <div className="ordering-controls">
                          <button
                            className="order-move-button"
                            type="button"
                            aria-label={'Переместить ' + item.label + ' выше'}
                            disabled={index === 0 || submitting || feedback?.result === 'correct'}
                            onClick={() => moveItem(index, -1)}
                          >
                            ↑
                          </button>
                          <button
                            className="order-move-button"
                            type="button"
                            aria-label={'Переместить ' + item.label + ' ниже'}
                            disabled={index === orderedItems.length - 1 || submitting || feedback?.result === 'correct'}
                            onClick={() => moveItem(index, 1)}
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {puzzle.hints.length ? (
                  <div className="guest-demo-hint-area">
                    {visibleHints > 0 ? (
                      <div className="hint-panel" role="status">
                        <strong>Подсказка</strong>
                        <p>{puzzle.hints[visibleHints - 1]}</p>
                      </div>
                    ) : null}
                    <button
                      className="guest-demo-hint-button"
                      type="button"
                      disabled={submitting || visibleHints >= puzzle.hints.length}
                      onClick={() => setVisibleHints((count) => Math.min(count + 1, puzzle.hints.length))}
                    >
                      {visibleHints >= puzzle.hints.length
                        ? 'Все подсказки открыты'
                        : visibleHints
                          ? 'Следующая подсказка'
                          : 'Открыть подсказку'}
                    </button>
                  </div>
                ) : null}

                {feedback ? (
                  <div
                    className={feedback.result === 'correct' ? 'feedback feedback-success' : 'feedback feedback-error'}
                    role="status"
                    aria-live="polite"
                  >
                    <strong>{feedback.result === 'correct' ? 'Верно!' : 'Пока не получилось'}</strong>
                    <span>{feedback.feedback}</span>
                    {feedback.result === 'incorrect' ? <span>Попробуй изменить ответ или открыть подсказку.</span> : null}
                  </div>
                ) : null}

                {error ? <p className="form-error" role="alert">{error}</p> : null}

                {feedback?.result === 'correct' ? (
                  <div className="guest-demo-success">
                    <p>Отличное начало! Весь квест, сохранение прогресса и награды доступны в личном аккаунте.</p>
                    <Link className="button button-primary" href="/register">
                      Создать аккаунт и пройти миссию
                    </Link>
                  </div>
                ) : (
                  <button className="button button-primary guest-demo-submit" type="submit" disabled={!answer || submitting}>
                    {submitting ? 'Проверяем…' : 'Проверить ответ'}
                  </button>
                )}
              </form>
              <p className="guest-demo-disclaimer">
                Это пробный пример: ответ проверяется сервером, но попытки и прогресс не сохраняются.
                В демо не начисляются XP и монеты.
              </p>
            </>
          ) : (
            <p className="form-error" role="alert">
              {error || 'Пример задания сейчас недоступен.'}
              <button className="guest-demo-retry" onClick={() => { setPreview(null); void openDemo(); }} type="button">
                Повторить
              </button>
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
