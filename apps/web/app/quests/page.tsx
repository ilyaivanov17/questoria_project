import Link from 'next/link';
import { QuestCatalog } from '../../components/quest-catalog';

export const metadata = {
  title: 'Каталог квестов',
  description: 'Выбирай образовательные миссии по логике, науке и цифровой грамотности.',
  alternates: { canonical: '/quests' },
};

interface QuestCard {
  slug: string; title: string; summary: string; difficulty: string; durationMin: number; ageMin: number; ageMax: number;
  coverUrl?: string | null; coverAlt?: string | null; skills?: string[]; levelCount?: number; puzzleCount?: number;
}
interface Category { slug: string; title: string; description: string; quests: QuestCard[] }
const apiBase = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

async function getCategories(): Promise<Category[]> {
  try {
    const response = await fetch(`${apiBase}/api/v1/public/categories`, { cache: 'no-store' });
    if (!response.ok) return [];
    return (await response.json()) as Category[];
  } catch { return []; }
}

export default async function QuestsPage() {
  const categories = await getCategories();
  const totalQuests = categories.reduce((sum, category) => sum + category.quests.length, 0);
  return (
    <main className="content-page">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">Q</span><span>questoria</span></Link>
        <nav className="simple-nav" aria-label="Основная навигация"><Link href="/login">Войти</Link><Link href="/profile">Профиль</Link><Link className="nav-cta" href="/register">Регистрация</Link></nav>
      </header>
      <section className="content-heading catalog-heading">
        <p className="eyebrow">БИБЛИОТЕКА МИССИЙ</p><h1>Выбери своё приключение</h1>
        <p>Каждый квест — небольшая история с головоломками, подсказками и наградой за открытие.</p>
        <div className="catalog-heading-meta"><span><strong>{totalQuests}</strong> миссий в каталоге</span><span><strong>{categories.length}</strong> тематик</span><span><strong>5</strong> форматов заданий</span></div>
      </section>
      {totalQuests ? <QuestCatalog categories={categories} /> : (
        <div className="empty-state"><span className="empty-icon">✧</span><h2>Квесты скоро появятся</h2><p>Каталог пока пуст. Обнови страницу чуть позже или загляни в прототип.</p><a className="text-link" href="https://github.com/ilyaivanov17/questoria_project/tree/main/prototype">Посмотреть прототип →</a></div>
      )}
    </main>
  );
}
