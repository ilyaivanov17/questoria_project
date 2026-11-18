'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getReviewTimingLabel, getSkillStatusLabel, type ReviewState, type SkillStatus } from '../lib/review-utils.mjs';

export interface ReviewQueueItem {
  skillId: string;
  skillKey: string;
  skillName: string;
  skillStatus: SkillStatus;
  lastCorrectAt: string;
  dueAt: string;
  intervalDays: number;
  daysOverdue: number;
  state: ReviewState;
  recommendedQuests: Array<{
    slug: string;
    title: string;
    difficulty: string | null;
    durationMin: number;
  }>;
}

export interface ReviewQueueResponse {
  generatedAt: string;
  items: ReviewQueueItem[];
  summary: {
    dueCount: number;
    upcomingCount: number;
    totalCount: number;
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
  }).format(new Date(value));
}

function ReviewItemCard({ item, compact = false }: { item: ReviewQueueItem; compact?: boolean }) {
  const due = item.state === 'due';
  return (
    <article className={due ? 'review-item-card review-item-due' : 'review-item-card review-item-upcoming'}>
      <div className="review-item-topline">
        <span className={due ? 'review-state-pill due' : 'review-state-pill upcoming'}>
          {due ? 'Пора повторить' : 'Предстоит'}
        </span>
        <span className="review-interval">Интервал · {item.intervalDays} дн.</span>
      </div>
      <div className="review-item-heading">
        <div>
          <h3>{item.skillName}</h3>
          <p>{getReviewTimingLabel(item.state, item.daysOverdue)}</p>
        </div>
        <span className={`skill-status-pill skill-status-${item.skillStatus}`}>
          {getSkillStatusLabel(item.skillStatus)}
        </span>
      </div>
      <p className="review-due-date">{due ? 'Срок повторения' : 'Следующая проверка'} · {formatDate(item.dueAt)}</p>
      <p className="review-last-success">Последний верный ответ · {formatDate(item.lastCorrectAt)}</p>
      {!compact && !item.recommendedQuests.length && due ? (
        <p className="review-no-quest">
          Пока нет опубликованной миссии с доступными prerequisites для этого навыка.
          <Link href="/quests">Посмотреть каталог →</Link>
        </p>
      ) : null}
      {!compact && item.recommendedQuests.length ? (
        <div className="review-recommendations">
          <strong>{due ? 'Подходящие миссии для повторения' : 'Подготовься к следующей проверке'}</strong>
          <div className="review-quest-links">
            {item.recommendedQuests.map((quest) => (
              <Link className="review-quest-link" href={`/quests/${encodeURIComponent(quest.slug)}`} key={quest.slug}>
                <span>{quest.title}</span>
                <small>{quest.durationMin} мин · {quest.difficulty ?? 'Любая сложность'}</small>
                <b aria-hidden="true">→</b>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {compact && item.recommendedQuests[0] ? (
        <Link className="review-compact-link" href={`/quests/${encodeURIComponent(item.recommendedQuests[0].slug)}`}>
          {due ? 'Открыть миссию' : 'Посмотреть миссию'} →
        </Link>
      ) : null}
    </article>
  );
}

export function ReviewQueuePreview({
  data,
  error,
}: {
  data: ReviewQueueResponse | null;
  error: string;
}) {
  return (
    <section className="profile-section review-preview-section" aria-labelledby="review-preview-heading">
      <div className="profile-section-heading">
        <div>
          <p className="eyebrow">ПАМЯТЬ И ПОВТОРЕНИЕ</p>
          <h2 id="review-preview-heading">Пора повторить</h2>
          <p className="skill-section-description">Короткие проверки помогают закрепить навык спустя время.</p>
        </div>
        {data ? (
          <span className="achievement-count">{data.summary.dueCount} сегодня</span>
        ) : null}
      </div>
      {error ? <p className="form-error" role="status">{error}</p> : null}
      {data?.items.length ? (
        <>
          <div className="review-preview-grid">
            {data.items.slice(0, 2).map((item) => <ReviewItemCard item={item} compact key={item.skillId} />)}
          </div>
          <Link className="text-link review-all-link" href="/review">Открыть всю очередь →</Link>
        </>
      ) : !error ? (
        <div className="review-empty-state">
          <span aria-hidden="true">✦</span>
          <div>
            <strong>Пока всё спокойно</strong>
            <p>После первых успешных ответов система предложит, когда вернуться к навыку.</p>
          </div>
          <Link className="text-link" href="/quests">Выбрать миссию →</Link>
        </div>
      ) : (
        <Link className="text-link" href="/review">Открыть очередь повторения →</Link>
      )}
    </section>
  );
}

export function ReviewQueueClient() {
  const router = useRouter();
  const [data, setData] = useState<ReviewQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadQueue = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/v1/me/review-queue', {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        router.replace('/login?next=%2Freview');
        return;
      }
      if (!response.ok) {
        throw new Error(body.message ?? body.error?.message ?? 'Не удалось загрузить очередь повторения.');
      }
      setData(body as ReviewQueueResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Сервер временно недоступен.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    queueMicrotask(() => { void loadQueue(); });
  }, [loadQueue]);

  return (
    <main className="review-page">
      <header className="topbar review-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">Q</span><span>questoria</span>
        </Link>
        <nav className="simple-nav" aria-label="Основная навигация">
          <Link href="/quests">К квестам</Link>
          <Link href="/profile">Профиль</Link>
          <Link href="/review" aria-current="page">Повторение</Link>
        </nav>
      </header>
      <section className="review-page-heading">
        <p className="eyebrow">ПЕРСОНАЛЬНЫЙ ПЛАН ОБУЧЕНИЯ</p>
        <h1>Пора повторить</h1>
        <p>Возвращайся к навыкам в подходящий момент. Верные ответы помогают закрепить знания, а ошибки дают ещё одну возможность разобраться.</p>
      </section>

      {loading ? (
        <section className="review-loading-grid" aria-busy="true" aria-live="polite">
          <span /><span />
        </section>
      ) : error ? (
        <section className="review-page-empty">
          <h2>Не удалось открыть очередь</h2>
          <p role="alert">{error}</p>
          <button className="button button-primary" onClick={() => { setLoading(true); void loadQueue(); }} type="button">
            Повторить загрузку
          </button>
        </section>
      ) : data ? (
        <>
          <section className="review-summary-grid" aria-label="Сводка повторения">
            <article><strong>{data.summary.dueCount}</strong><span>Пора сегодня</span></article>
            <article><strong>{data.summary.upcomingCount}</strong><span>Скоро</span></article>
            <article><strong>{data.summary.totalCount}</strong><span>Всего навыков в плане</span></article>
          </section>
          {data.items.length ? (
            <section className="review-full-list" aria-label="Очередь повторения">
              {data.items.map((item) => <ReviewItemCard item={item} key={item.skillId} />)}
            </section>
          ) : (
            <section className="review-page-empty">
              <span aria-hidden="true">✦</span>
              <h2>На сегодня повторений нет</h2>
              <p>Продолжай исследовать новые темы. Когда появится подходящий момент, мы добавим навык в эту очередь.</p>
              <Link className="button button-primary" href="/quests">Выбрать миссию →</Link>
            </section>
          )}
        </>
      ) : null}
      <p className="review-footnote">Сроки рассчитываются по успешным учебным попыткам. Неправильный ответ не стирает историю освоения.</p>
    </main>
  );
}
