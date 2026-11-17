import Link from 'next/link';
import { QuestCatalog } from '../../components/quest-catalog';

export const metadata = {
  title: 'Каталог квестов',
  description: 'Выбирай образовательные миссии по логике, науке и цифровой грамотности.',
  alternates: { canonical: '/quests' },
};

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
const apiBase = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

async function getCategories(): Promise<Category[] | null> {
  try {
    const response = await fetch(apiBase + '/api/v1/public/categories', { cache: 'no-store' });
    if (!response.ok) return null;
    const categories = (await response.json()) as Category[];
    return Array.isArray(categories) ? categories : null;
  } catch {
    return null;
  }
}

export default async function QuestsPage() {
  const categories = await getCategories();
  const totalQuests = categories?.reduce((sum, category) => sum + category.quests.length, 0) ?? 0;

  return (
    <main className="content-page">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">Q</span><span>questoria</span>
        </Link>
        <nav className="simple-nav" aria-label="Основная навигация">
          <Link href="/login">Войти</Link>
          <Link href="/profile">Профиль</Link>
          <Link className="nav-cta" href="/register">Регистрация</Link>
        </nav>
      </header>

      <section className="content-heading catalog-heading">
        <p className="eyebrow">БИБЛИОТЕКА МИССИЙ</p>
        <h1>Выбери своё приключение</h1>
        <p>Каждый квест — небольшая история с головоломками, подсказками и наградой за открытие.</p>
        {categories !== null ? (
          <div className="catalog-heading-meta">
            <span><strong>{totalQuests}</strong> миссий в каталоге</span>
            <span><strong>{categories.length}</strong> тематик</span>
            <span><strong>5</strong> форматов заданий</span>
          </div>
        ) : null}
      </section>

      {categories === null ? (
        <section className="empty-state catalog-unavailable" role="alert">
          <span className="empty-icon" aria-hidden="true">⌁</span>
          <h2>Не удалось загрузить каталог</h2>
          <p>Сейчас не получается связаться с библиотекой миссий. Проверь соединение и повтори запрос.</p>
          <a className="button button-secondary" href="/quests">Повторить загрузку</a>
        </section>
      ) : totalQuests > 0 ? (
        <QuestCatalog categories={categories} />
      ) : (
        <section className="empty-state" role="status">
          <span className="empty-icon" aria-hidden="true">✧</span>
          <h2>Пока нет опубликованных миссий</h2>
          <p>Новые квесты появятся в каталоге после редакторской проверки. Загляни позже.</p>
          <Link className="text-link" href="/">На главную <span aria-hidden="true">→</span></Link>
        </section>
      )}
    </main>
  );
}
