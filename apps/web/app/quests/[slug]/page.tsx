import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StartQuestButton } from '../../../components/start-quest-button';

interface PublicQuest {
  slug: string;
  category: { slug: string; title: string };
  title: string;
  summary: string;
  objectives: string[];
  ageMin: number;
  ageMax: number;
  difficulty: string;
  durationMin: number;
  seo?: { title?: string; description?: string } | null;
  levels: Array<{
    title: string;
    intro: string;
    puzzles: Array<{
      type: string;
      prompt: string;
      options: Array<{ id: string; label: string }>;
      hints: string[];
    }>;
  }>;
}

const apiBase = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

async function getQuest(slug: string): Promise<PublicQuest | null> {
  try {
    const response = await fetch(
      `${apiBase}/api/v1/public/quests/${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    );
    if (response.status === 404) return null;
    if (!response.ok) return null;
    return (await response.json()) as PublicQuest;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const quest = await getQuest(slug);
  if (!quest) return { title: 'Квест не найден', robots: { index: false } };

  return {
    title: quest.seo?.title ?? quest.title,
    description: quest.seo?.description ?? quest.summary,
    alternates: { canonical: `/quests/${quest.slug}` },
  };
}

export default async function QuestDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const quest = await getQuest(slug);
  if (!quest) notFound();

  const preview = quest.levels[0]?.puzzles[0];

  return (
    <main className="content-page">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">Q</span>
          <span>questoria</span>
        </Link>
        <Link className="simple-nav-link" href="/quests">Все квесты</Link>
      </header>

      <div className="breadcrumbs">
        <Link href="/quests">Квесты</Link>
        <span>/</span>
        <Link href={`/quests?category=${quest.category.slug}`}>{quest.category.title}</Link>
      </div>

      <section className="quest-detail">
        <div className="quest-detail-copy">
          <p className="eyebrow">ТВОЯ СЛЕДУЮЩАЯ МИССИЯ</p>
          <h1>{quest.title}</h1>
          <p className="quest-lead">{quest.summary}</p>
          <div className="quest-meta detail-meta">
            <span>{quest.difficulty}</span>
            <span>{quest.durationMin} минут</span>
            <span>{quest.ageMin}+</span>
          </div>
          <div className="objectives">
            <h2>Чему ты научишься</h2>
            <ul>
              {quest.objectives.map((objective) => <li key={objective}>{objective}</li>)}
            </ul>
          </div>
          <StartQuestButton slug={quest.slug} />
          <p className="small-note">Нужен аккаунт, чтобы сохранять прохождение.</p>
        </div>

        <aside className="preview-card">
          <span className="preview-label">ПРИМЕР ЗАДАНИЯ</span>
          <span className="preview-icon">⌘</span>
          <h2>{preview?.prompt ?? 'Готов отправиться в путешествие?'}</h2>
          <div className="preview-options">
            {(preview?.options ?? []).map((option) => (
              <div className="preview-option" key={option.id}>
                <span className="option-dot" />
                {option.label}
              </div>
            ))}
          </div>
          <p className="small-note">Правильный ответ останется секретом до прохождения квеста.</p>
        </aside>
      </section>
    </main>
  );
}
