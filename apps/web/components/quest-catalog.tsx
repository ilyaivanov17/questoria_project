'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { matchesDuration, missionCountLabel, type QuestDurationFilter } from '../lib/catalog-utils.mjs';

interface QuestCard {
  slug: string;
  title: string;
  summary: string;
  difficulty: string;
  durationMin: number;
  ageMin: number;
  ageMax: number;
  coverUrl?: string | null;
  coverAlt?: string | null;
  skills?: string[];
  levelCount?: number;
  puzzleCount?: number;
}
interface Category {
  slug: string;
  title: string;
  description: string;
  quests: QuestCard[];
}

const difficultyLabel: Record<string, string> = {
  beginner: 'Начальная',
  intermediate: 'Средняя',
  advanced: 'Продвинутая',
  Начальный: 'Начальная',
  Средний: 'Средняя',
  Продвинутый: 'Продвинутая',
};

function difficultyKey(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('нач') || normalized === 'beginner') return 'beginner';
  if (normalized.includes('сред') || normalized === 'intermediate') return 'intermediate';
  if (normalized.includes('продв') || normalized === 'advanced') return 'advanced';
  return normalized;
}

export function QuestCatalog({ categories }: { categories: Category[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [difficulty, setDifficulty] = useState('all');
  const [duration, setDuration] = useState<QuestDurationFilter>('all');
  const [sort, setSort] = useState('recommended');

  const allQuests = useMemo(
    () =>
      categories.flatMap((item) =>
        item.quests.map((quest) => ({
          ...quest,
          categorySlug: item.slug,
          categoryTitle: item.title,
        })),
      ),
    [categories],
  );

  const visibleQuests = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('ru-RU');
    const filtered = allQuests.filter((quest) => {
      const matchesCategory = category === 'all' || quest.categorySlug === category;
      const matchesDifficulty =
        difficulty === 'all' || difficultyKey(quest.difficulty) === difficulty;
      const matchesSearch = [
        quest.title,
        quest.summary,
        quest.categoryTitle,
        ...(quest.skills ?? []),
      ]
        .join(' ')
        .toLocaleLowerCase('ru-RU')
        .includes(search);
      return (
        matchesCategory &&
        matchesDifficulty &&
        matchesDuration(quest.durationMin, duration) &&
        (!search || matchesSearch)
      );
    });

    if (sort === 'shortest') filtered.sort((a, b) => a.durationMin - b.durationMin);
    if (sort === 'longest') filtered.sort((a, b) => b.durationMin - a.durationMin);
    if (sort === 'name') filtered.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    return filtered;
  }, [allQuests, category, difficulty, duration, query, sort]);

  function resetFilters() {
    setQuery('');
    setCategory('all');
    setDifficulty('all');
    setDuration('all');
    setSort('recommended');
  }

  const hasActiveFilters =
    Boolean(query) ||
    category !== 'all' ||
    difficulty !== 'all' ||
    duration !== 'all' ||
    sort !== 'recommended';

  return (
    <section className="catalog-explorer" aria-label="Поиск и фильтры квестов">
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название, тема или навык"
            aria-label="Поиск квестов"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Очистить поиск"
            >
              ×
            </button>
          )}
        </label>
        <label className="catalog-sort">
          <span>Сортировка</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="recommended">По умолчанию</option>
            <option value="shortest">Сначала короткие</option>
            <option value="longest">Сначала длинные</option>
            <option value="name">По названию</option>
          </select>
        </label>
      </div>

      <div className="catalog-filter-row">
        <div className="catalog-chips" role="group" aria-label="Фильтр по тематике">
          <button
            className={category === 'all' ? 'filter-chip active' : 'filter-chip'}
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
            type="button"
          >
            Все темы
          </button>
          {categories.map((item) => (
            <button
              className={category === item.slug ? 'filter-chip active' : 'filter-chip'}
              aria-pressed={category === item.slug}
              key={item.slug}
              onClick={() => setCategory(item.slug)}
              type="button"
            >
              {item.title}
            </button>
          ))}
        </div>

        <div className="catalog-select-filters">
          <label className="catalog-difficulty">
            <span>Сложность</span>
            <select
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value)}
              aria-label="Сложность квеста"
            >
              <option value="all">Любая</option>
              <option value="beginner">Начальная</option>
              <option value="intermediate">Средняя</option>
              <option value="advanced">Продвинутая</option>
            </select>
          </label>
          <label className="catalog-duration">
            <span>Время</span>
            <select
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              aria-label="Продолжительность квеста"
            >
              <option value="all">Любая</option>
              <option value="quick">До 10 минут</option>
              <option value="standard">11–20 минут</option>
              <option value="long">Более 20 минут</option>
            </select>
          </label>
        </div>
      </div>

      <div className="catalog-results-head">
        <p aria-live="polite" role="status">
          Найдено <strong>{visibleQuests.length}</strong> {missionCountLabel(visibleQuests.length)}
        </p>
        {hasActiveFilters && (
          <button className="catalog-reset" type="button" onClick={resetFilters}>
            Сбросить фильтры
          </button>
        )}
      </div>

      {visibleQuests.length ? (
        <div className="quest-grid">
          {visibleQuests.map((quest) => (
            <article className="quest-card quest-card-enhanced" key={quest.slug}>
              <Link
                className="quest-card-link"
                href={'/quests/' + quest.slug}
                aria-label={'Открыть квест «' + quest.title + '»'}
              >
                <div className="quest-cover">
                  {quest.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={quest.coverUrl}
                      alt={quest.coverAlt || quest.title}
                      loading="lazy"
                    />
                  ) : (
                    <div className="quest-cover-art" aria-hidden="true">
                      <span>✧</span><i>Q</i><b>✦</b>
                    </div>
                  )}
                  <span className="quest-cover-category">{quest.categoryTitle}</span>
                </div>
                <div className="quest-card-body">
                  <div className="quest-card-top">
                    <span className="quest-symbol" aria-hidden="true">✦</span>
                    <span className="quest-category">
                      {difficultyLabel[quest.difficulty] ?? quest.difficulty}
                    </span>
                  </div>
                  <h2>{quest.title}</h2>
                  <p>{quest.summary}</p>
                  <div className="quest-meta quest-meta-enhanced">
                    <span>◷ {quest.durationMin} мин</span>
                    <span>♧ {quest.ageMin}+</span>
                    {quest.levelCount ? <span>{quest.levelCount} этапа</span> : null}
                    {quest.puzzleCount ? <span>{quest.puzzleCount} заданий</span> : null}
                  </div>
                </div>
                <span className="quest-card-cta">
                  Открыть миссию <b aria-hidden="true">→</b>
                </span>
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="catalog-empty" role="status">
          <span aria-hidden="true">⌕</span>
          <h2>По этим условиям миссий нет</h2>
          <p>Измени поисковый запрос или сними часть фильтров — так найдётся больше вариантов.</p>
          <button className="button button-secondary" type="button" onClick={resetFilters}>
            Показать все квесты
          </button>
        </div>
      )}
    </section>
  );
}
