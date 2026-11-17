import Link from 'next/link';

const foundations = [
  {
    number: '01',
    title: 'Исследуй',
    description: 'Выбирай тему и отправляйся в короткую сюжетную миссию.',
  },
  {
    number: '02',
    title: 'Решай',
    description: 'Проходи задания, проверяй гипотезы и получай объяснения.',
  },
  {
    number: '03',
    title: 'Расти',
    description: 'Отслеживай навыки и прогресс — без гонки и давления.',
  },
];

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Questoria — главная">
          <span className="brand-mark">Q</span>
          <span>questoria</span>
        </Link>
        <nav className="simple-nav" aria-label="Основная навигация">
          <Link href="/quests">Квесты</Link>
          <Link href="/profile">Мой прогресс</Link>
          <Link href="/login">Войти</Link>
          <Link className="nav-cta" href="/register">Начать</Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">УЧИСЬ ИССЛЕДУЯ</p>
          <h1>
            Знания
            <br />
            становятся <span>приключением.</span>
          </h1>
          <p className="hero-description">
            Короткие истории, умные головоломки и задания, которые превращают новые знания в
            настоящее открытие.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/quests">
              Выбрать квест <span aria-hidden="true">→</span>
            </Link>
            <a
              className="button button-secondary"
              href="https://github.com/ilyaivanov17/questoria_project/tree/main/prototype"
              target="_blank"
              rel="noreferrer"
            >
              Посмотреть прототип
            </a>
          </div>
          <p className="hero-footnote">Первый интерактивный квест уже доступен в каталоге.</p>
        </div>

        <div className="hero-art" aria-label="Иллюстрация игровой карты" role="img">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="planet planet-large">✦</div>
          <div className="planet planet-small">?</div>
          <div className="map-card">
            <span className="map-card-label">ТВОЯ СЛЕДУЮЩАЯ МИССИЯ</span>
            <span className="map-card-icon">⌘</span>
            <strong>Тайна пропавшего числа</strong>
            <span className="map-card-meta">Логика · 5 испытаний</span>
            <span className="map-progress"><span /></span>
            <span className="map-card-reward">✦ 40 XP · ◈ 15 монет за первое прохождение</span>
          </div>
          <span className="sparkle sparkle-one">✧</span>
          <span className="sparkle sparkle-two">✳</span>
          <span className="sparkle sparkle-three">✦</span>
        </div>
      </section>

      <section className="principles" aria-labelledby="principles-title">
        <div className="section-heading">
          <p className="eyebrow">КАК ЭТО РАБОТАЕТ</p>
          <h2 id="principles-title">Каждая миссия — маленькое открытие</h2>
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
        <article><span>01</span><strong>Пять форматов задач</strong><p>Выбирай ответ, вводи число или текст, находи порядок и связи.</p></article>
        <article><span>02</span><strong>Подсказки по пути</strong><p>Открывай идеи постепенно и возвращайся к объяснениям после ответа.</p></article>
        <article><span>03</span><strong>Прогресс и награды</strong><p>Сохраняй прохождения, копи XP и открывай достижения исследователя.</p></article>
      </section>
      <section className="home-cta">
        <div><p className="eyebrow">ПЕРВАЯ МИССИЯ УЖЕ ЖДЁТ</p><h2>Открой закономерность. Получи свою первую награду.</h2><p>Пройди пять испытаний в квесте «Тайна пропавшего числа» и сохрани результат в профиле.</p></div>
        <Link className="button button-primary" href="/quests">В каталог миссий <span aria-hidden="true">→</span></Link>
      </section>
      <footer className="footer">
        <span>Questoria © {new Date().getFullYear()}</span><span>Учись исследуя</span>
      </footer>
    </main>
  );
}
