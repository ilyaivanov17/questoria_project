import Link from 'next/link';

const apiHealthUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
        <span className="topbar-note">Платформа в разработке</span>
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
            <a
              className="button button-primary"
              href={apiHealthUrl + '/api/health'}
              target="_blank"
              rel="noreferrer"
            >
              Проверить API <span aria-hidden="true">↗</span>
            </a>
            <a
              className="button button-secondary"
              href="https://github.com/ilyaivanov17/questoria_project/tree/main/prototype"
              target="_blank"
              rel="noreferrer"
            >
              Посмотреть прототип
            </a>
          </div>
          <p className="hero-footnote">Сейчас создаём технический фундамент первого MVP.</p>
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
            <span className="map-card-meta">Логика · 8 минут</span>
            <span className="map-progress"><span /></span>
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

      <footer className="footer">
        <span>Questoria © {new Date().getFullYear()}</span>
        <span>Создаём основу для первого квеста</span>
      </footer>
    </main>
  );
}
