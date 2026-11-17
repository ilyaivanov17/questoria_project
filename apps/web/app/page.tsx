import Link from 'next/link';

interface HomeQuest {
  slug: string;
  title: string;
  summary: string;
  difficulty: string;
  durationMin: number;
  ageMin: number;
  coverUrl?: string | null;
  coverAlt?: string | null;
}
interface HomeCategory {
  slug: string;
  title: string;
  description: string;
  quests: HomeQuest[];
}

const apiBase = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

async function getPublicCategories(): Promise<HomeCategory[] | null> {
  try {
    const response = await fetch(\`\${apiBase}/api/v1/public/categories\`, { cache: 'no-store' });
    if (!response.ok) return null;
    const categories = (await response.json()) as HomeCategory[];
    return Array.isArray(categories) ? categories : null;
  } catch {
    return null;
  }
}

function difficultyLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('нач') || normalized === 'beginner') return 'Начальный уровень';
  if (normalized.includes('сред') || normalized === 'intermediate') return 'Средний уровень';
  if (normalized.includes('продв') || normalized === 'advanced') return 'Продвинутый уровень';
  return value;
}

function missionWord(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'миссий';
  if (last === 1) return 'миссия';
  if (last >= 2 && last <= 4) return 'миссии';
  return 'миссий';
}

const foundations = [
  {
    number: '01',
    title: 'Исследуй',
    description: 'Выбирай тему и погружайся в небольшую сюжетную миссию.',
  },
  {
    number: '02',
    title: 'Пробуй',
    description: 'Решай задачи, проверяй идеи и открывай подсказки по пути.',
  },
  {
    number: '03',
    title: 'Расти',
    description: 'Возвращайся к прохождениям и наблюдай за своим прогрессом.',
  },
];

export default async function HomePage() {
  const categories = await getPublicCategories();
  const quests = categories?.flatMap((category) =>
    category.quests.map((quest) => ({ ...quest, categoryTitle: category.title })),
  ) ?? [];
  const featuredQuests = quests.slice(0, 3);
  const totalQuests = quests.length;

  return (
    <main className="page-shell home-page">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Questoria — главная">
          <span className="brand-mark">Q</span>
          <span>questoria</span>
        </Link>
        <nav className="simple-nav" aria-label="Основная навигация">
          <Link href="/quests">Каталог</Link>
          <Link href="/#how-it-works">Как это работает</Link>
          <Link href="/login">Войти</Link>
          <Link className="nav-cta" href="/register">Начать исследовать</Link>
        </nav>
      </header>

      <section className="hero home-hero">
        <div className="hero-copy">
          <p className="eyebrow">ОБРАЗОВАТЕЛЬНЫЕ МИССИИ · ЖИВОЙ ИНТЕРЕС</p>
          <h1>
            Знания не нужно
            <br />
            заучивать.
            <br />
            Их можно <span>открыть.</span>
          </h1>
          <p className="hero-description">
            Questoria превращает любопытство в приключение: исследуй темы, решай головоломки и
            узнавай, как устроен мир — шаг за шагом и в своём темпе.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/quests">
              Найти свою миссию <span aria-hidden="true">→</span>
            </Link>
            <Link className="button button-secondary" href="/#how-it-works">
              Как это устроено
            </Link>
          </div>
          <div className="home-trust-row" aria-label="Особенности платформы">
            <span><b aria-hidden="true">✦</b> Короткие миссии</span>
            <span><b aria-hidden="true">⌘</b> Пять форматов задач</span>
            <span><b aria-hidden="true">↗</b> Прогресс сохраняется</span>
          </div>
        </div>

        <div className="hero-art home-hero-art" role="img" aria-label="Схематичная карта исследовательского путешествия">
          <div className="home-orbit home-orbit-one" />
          <div className="home-orbit home-orbit-two" />
          <span className="home-star home-star-one" aria-hidden="true">✦</span>
          <span className="home-star home-star-two" aria-hidden="true">✧</span>
          <span className="home-planet home-planet-one" aria-hidden="true">?</span>
          <span className="home-planet home-planet-two" aria-hidden="true">✳</span>
          <div className="home-map-card">
            <span className="home-map-kicker">ТВОЯ КАРТА ОТКРЫТИЙ</span>
            <div className="home-map-path" aria-hidden="true">
              <span className="home-map-node complete">✓</span>
              <span className="home-map-line" />
              <span className="home-map-node active">✦</span>
              <span className="home-map-line" />
              <span className="home-map-node">?</span>
            </div>
            <strong>Любой вопрос — начало приключения</strong>
            <p>Наблюдай · Думай · Находи связи</p>
          </div>
          <span className="home-art-caption">У каждого открытия свой маршрут</span>
        </div>
      </section>

      <section className="home-proof" aria-label="Questoria в цифрах">
        <div><strong>{categories === null ? '—' : totalQuests}</strong><span>опубликованных миссий</span></div>
        <div><strong>{categories === null ? '—' : categories.length}</strong><span>тематических направлений</span></div>
        <div><strong>5</strong><span>типов интерактивных задач</span></div>
        <div><strong>∞</strong><span>способов проявить любопытство</span></div>
      </section>

      <section className="principles home-principles" id="how-it-works" aria-labelledby="principles-title">
        <div className="section-heading">
          <p className="eyebrow">ТВОЙ ПУТЬ ИССЛЕДОВАТЕЛЯ</p>
          <h2 id="principles-title">Учёба, в которой хочется разобраться</h2>
          <p>Не просто выбрать ответ, а понять, почему он верный — и попробовать снова, если не получилось.</p>
        </div>
        <div className="principle-grid">
          {foundations.map((item) => (
            <article className="principle-card" key={item.number}>
              <span className="principle-number">{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-feature-strip" aria-label="Возможности Questoria">
        <article><span>01</span><strong>Разные способы думать</strong><p>Выбирай варианты, вводи ответ, расставляй элементы по порядку или находи число.</p></article>
        <article><span>02</span><strong>Поддержка без спешки</strong><p>Открывай подсказки постепенно. Ошибка помогает разобраться, а не повод сдаваться.</p></article>
        <article><span>03</span><strong>Твой результат</strong><p>Сервер сохраняет прохождения, опыт, монеты и достижения в личном профиле.</p></article>
      </section>

      <section className="home-missions" aria-labelledby="home-missions-title">
        <div className="home-section-heading">
          <div>
            <p className="eyebrow">ОТКРЫТЫЕ МАРШРУТЫ</p>
            <h2 id="home-missions-title">С чего начнётся твоё приключение?</h2>
            <p>Выбирай миссию по интересу, а не по уровню подготовки.</p>
          </div>
          <Link className="text-link" href="/quests">Весь каталог <span aria-hidden="true">→</span></Link>
        </div>

        {categories === null ? (
          <div className="home-catalog-state" role="alert">
            <span aria-hidden="true">⌁</span>
            <div><strong>Каталог временно недоступен</strong><p>Не удалось получить список миссий. Попробуй обновить страницу чуть позже.</p></div>
            <a className="text-link" href="/">Повторить загрузку</a>
          </div>
        ) : featuredQuests.length > 0 ? (
          <div className="home-mission-grid">
            {featuredQuests.map((quest) => (
              <article className="home-mission-card" key={quest.slug}>
                <Link href={'/quests/' + quest.slug} className="home-mission-link" aria-label={'Открыть миссию «' + quest.title + '»'}>
                  <div className="home-mission-cover">
                    {quest.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={quest.coverUrl} alt={quest.coverAlt || quest.title} loading="lazy" />
                    ) : <div className="quest-cover-art" aria-hidden="true"><span>✧</span><i>Q</i><b>✦</b></div>}
                    <span>{quest.categoryTitle}</span>
                  </div>
                  <div className="home-mission-copy">
                    <div className="home-mission-meta"><span>{difficultyLabel(quest.difficulty)}</span><span>{quest.durationMin} мин</span></div>
                    <h3>{quest.title}</h3>
                    <p>{quest.summary}</p>
                    <strong className="home-mission-cta">Посмотреть миссию <span aria-hidden="true">→</span></strong>
                  </div>
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="home-catalog-state">
            <span aria-hidden="true">✧</span>
            <div><strong>Новые миссии уже в разработке</strong><p>Пока в каталоге нет опубликованных квестов. Загляни сюда позже — новые истории появятся после проверки.</p></div>
            <Link className="text-link" href="/quests">Открыть каталог</Link>
          </div>
        )}

        {categories && categories.length > 0 ? (
          <div className="home-category-row" aria-label="Тематические направления">
            <span>Исследуй темы:</span>
            {categories.map((category) => <span className="home-category-chip" key={category.slug}>{category.title}</span>)}
          </div>
        ) : null}
      </section>

      <section className="home-cta">
        <div>
          <p className="eyebrow">ТВОЁ СЛЕДУЮЩЕЕ ОТКРЫТИЕ БЛИЖЕ, ЧЕМ КАЖЕТСЯ</p>
          <h2>Начни с одного вопроса. Закончи новым пониманием.</h2>
          <p>Проходи миссии в своём темпе, сохраняй результат и возвращайся к тому, что интересно именно тебе.</p>
        </div>
        <Link className="button button-primary" href="/quests">Выбрать миссию <span aria-hidden="true">→</span></Link>
      </section>

      <footer className="footer">
        <span>Questoria © {new Date().getFullYear()}</span>
        <span>Учись, исследуя мир</span>
      </footer>
    </main>
  );
}
