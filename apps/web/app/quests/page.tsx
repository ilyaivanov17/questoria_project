import Link from 'next/link';

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
}

interface Category {
  slug: string;
  title: string;
  description: string;
  quests: QuestCard[];
}

const apiBase = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

async function getCategories(): Promise<Category[]> {
  try {
    const response = await fetch(`${apiBase}/api/v1/public/categories`, {
      cache: 'no-store',
    });
    if (!response.ok) return [];
    return (await response.json()) as Category[];
  } catch {
    return [];
  }
}

export default async function QuestsPage() {
  const categories = await getCategories();
  const quests = categories.flatMap((category) =>
    category.quests.map((quest) => ({ ...quest, categoryTitle: category.title })),
  );

  return (
    <main className="content-page">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">Q</span>
          <span>questoria</span>
        </Link>
        <nav className="simple-nav" aria-label="Основная навигация">
          <Link href="/login">Войти</Link>
          <Link className="nav-cta" href="/register">Регистрация</Link>
        </nav>
      </header>

      <section className="content-heading">
        <p className="eyebrow">БИБЛИОТЕКА МИССИЙ</p>
        <h1>Выбери своё приключение</h1>
        <p>Короткие квесты, в которых интересно думать, пробовать и находить объяснения.</p>
      </section>

      {quests.length ? (
        <div className="quest-grid">
          {quests.map((quest) => (
            <article className="quest-card" key={quest.slug}>
              <div className="quest-card-top">
                <span className="quest-symbol">✦</span>
                <span className="quest-category">{quest.categoryTitle}</span>
              </div>
              <h2>{quest.title}</h2>
              <p>{quest.summary}</p>
              <div className="quest-meta">
                <span>{quest.difficulty}</span>
                <span>{quest.durationMin} мин</span>
                <span>{quest.ageMin}+</span>
              </div>
              <Link className="text-link" href={`/quests/${quest.slug}`}>
                Подробнее <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">✧</span>
          <h2>Квесты скоро появятся</h2>
          <p>Сервер каталога пока недоступен или контент ещё не загружен. Попробуй обновить страницу.</p>
          <a className="text-link" href="https://github.com/ilyaivanov17/questoria_project/blob/main/prototype/index.html">Посмотреть прототип →</a>
        </div>
      )}
    </main>
  );
}
