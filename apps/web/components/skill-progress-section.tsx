import Link from 'next/link';
import {
  getEvidenceTypeLabel,
  getSkillStatusLabel,
  type EvidenceKind,
  type SkillStatus,
} from '../lib/review-utils.mjs';

export interface PlayerSkillItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  difficulty: string | null;
  status: SkillStatus;
  available: boolean;
  prerequisites: Array<{
    id: string;
    key: string;
    name: string;
    status: SkillStatus;
    mastered: boolean;
  }>;
  attemptsCount: number;
  successfulAttempts: number;
  distinctPuzzles: number;
  distinctQuestVersions: number;
  distinctQuests: number;
  distinctRuns: number;
  distinctTaskTypes: number;
  firstPracticedAt: string | null;
  lastPracticedAt: string | null;
  masteredAt: string | null;
  trend: {
    direction: 'insufficient_data' | 'improving' | 'stable' | 'declining';
    recentAttempts: number;
    recentSuccessful: number;
    recentSuccessRate: number | null;
    previousAttempts: number;
    previousSuccessful: number;
    previousSuccessRate: number | null;
  };
  recommendedQuests: Array<{
    slug: string;
    title: string;
    difficulty: string | null;
    durationMin: number;
  }>;
}

export interface PlayerLearningEvidence {
  id: string;
  skillKey: string;
  skillName: string;
  taskType: string;
  evidenceType: EvidenceKind;
  isCorrect: boolean;
  score: number;
  occurredAt: string;
  questTitle: string;
  questSlug: string;
  levelTitle: string;
  puzzleOrder: number;
}

export interface PlayerSkillsResponse {
  skills: PlayerSkillItem[];
  recentEvidence: PlayerLearningEvidence[];
  summary: {
    totalSkills: number;
    practicedSkills: number;
    masteredSkills: number;
    trendTrackedSkills: number;
    improvingSkills: number;
    stableSkills: number;
    decliningSkills: number;
  };
}

interface SkillReviewItem {
  skillId: string;
  state: 'due' | 'upcoming';
  intervalDays: number;
  daysOverdue: number;
  recommendedQuests: Array<{
    slug: string;
    title: string;
    difficulty: string | null;
    durationMin: number;
  }>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(value));
}

export function SkillProgressSection({
  data,
  error,
  reviewItems = [],
}: {
  data: PlayerSkillsResponse | null;
  error: string;
  reviewItems?: SkillReviewItem[];
}) {
  return (
    <section className="profile-section skill-progress-section" id="skills" aria-labelledby="skill-progress-heading">
      <div className="profile-section-heading">
        <div>
          <p className="eyebrow">КАРТА ОБУЧЕНИЯ</p>
          <h2 id="skill-progress-heading">Навыки и освоение</h2>
          <p className="skill-section-description">Смотри, что уже получается и в каких форматах ты применяешь знания.</p>
        </div>
        {data ? (
          <span className="achievement-count">{data.summary.masteredSkills} / {data.summary.totalSkills} освоено</span>
        ) : null}
      </div>

      {error ? <p className="form-error" role="status">{error}</p> : null}

      {data && data.summary.trendTrackedSkills > 0 ? (
        <p className="skill-trend-summary">
          Динамика по навыкам: растут — {data.summary.improvingSkills}, стабильны — {data.summary.stableSkills},
          требуют внимания — {data.summary.decliningSkills}
        </p>
      ) : null}

      {data?.skills.length ? (
        <div className="skill-progress-grid">
          {data.skills.map((skill) => {
            const accuracy = skill.attemptsCount > 0
              ? Math.round((skill.successfulAttempts / skill.attemptsCount) * 100)
              : 0;
            const dueReview = reviewItems.find((item) => (
              item.skillId === skill.id && item.state === 'due'
            ));
            const isDeclining = skill.trend.direction === 'declining' && skill.status !== 'mastered';
            const nextStepTitle = dueReview
              ? 'Пора повторить'
              : isDeclining
                ? 'Закрепи тему'
                : skill.status === 'mastered'
                  ? 'Следующий уровень'
                  : 'Продолжай практику';
            const nextStepReason = dueReview
              ? `По графику отложенного повторения срок проверки наступил${dueReview.daysOverdue > 0 ? ` ${dueReview.daysOverdue} дн. назад` : ' сегодня'} (интервал ${dueReview.intervalDays} дн.).`
              : isDeclining && skill.trend.recentSuccessRate !== null && skill.trend.previousSuccessRate !== null
                ? `В последних ${skill.trend.recentAttempts} ответах верно ${skill.trend.recentSuccessRate}% против ${skill.trend.previousSuccessRate}% в предыдущих ${skill.trend.previousAttempts}. Стоит закрепить тему.`
                : skill.status === 'mastered'
                  ? 'Навык освоен. Можно перейти к миссиям следующей сложности.'
                  : 'Продолжай практику на текущем уровне: для перехода дальше нужны успешные решения разных задач и форматов.';
            const nextStepQuests = dueReview?.recommendedQuests ?? skill.recommendedQuests;
            return (
              <article className="skill-progress-card" key={skill.id}>
                <div className="skill-card-heading">
                  <div>
                    <h3>{skill.name}</h3>
                    {skill.description ? <p>{skill.description}</p> : null}
                  </div>
                  <span className={`skill-status-pill skill-status-${skill.status}`}>
                    {getSkillStatusLabel(skill.status)}
                  </span>
                </div>
                {skill.attemptsCount > 0 ? (
                  <>
                    <div className="skill-accuracy-heading">
                      <span>Верные ответы</span>
                      <strong>{skill.successfulAttempts} из {skill.attemptsCount}</strong>
                    </div>
                    <div
                      className="skill-accuracy-track"
                      role="progressbar"
                      aria-label={`Доля верных ответов по навыку «${skill.name}»`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={accuracy}
                      aria-valuetext={`${accuracy}% верных ответов`}
                    >
                      <span style={{ width: `${accuracy}%` }} />
                    </div>
                    <div className="skill-diversity-row">
                      <span>{skill.distinctPuzzles} задач</span>
                      <span>{skill.distinctTaskTypes} форматов</span>
                      <span>{skill.distinctQuests} миссий</span>
                    </div>
                    <div className="skill-trend-panel">
                      <div className="skill-trend-heading">
                        <strong>Динамика ответов</strong>
                        <span className={`skill-trend-state skill-trend-${skill.trend.direction}`}>
                          {skill.trend.direction === 'improving'
                            ? 'Растёт'
                            : skill.trend.direction === 'stable'
                              ? 'Стабильно'
                              : skill.trend.direction === 'declining'
                                ? 'Снизилась'
                                : 'Собираем данные'}
                        </span>
                      </div>
                      <div className="skill-trend-window">
                        <span>Последние {skill.trend.recentAttempts}</span>
                        <div className="skill-trend-track" role="img" aria-label={`Верно ${skill.trend.recentSuccessRate ?? 0}% в последних ответах`}>
                          <span style={{ width: `${skill.trend.recentSuccessRate ?? 0}%` }} />
                        </div>
                        <strong>{skill.trend.recentSuccessRate === null ? '—' : `${skill.trend.recentSuccessRate}%`}</strong>
                      </div>
                      {skill.trend.previousAttempts > 0 ? (
                        <div className="skill-trend-window">
                          <span>До этого {skill.trend.previousAttempts}</span>
                          <div className="skill-trend-track" role="img" aria-label={`Верно ${skill.trend.previousSuccessRate ?? 0}% в предыдущих ответах`}>
                            <span style={{ width: `${skill.trend.previousSuccessRate ?? 0}%` }} />
                          </div>
                          <strong>{skill.trend.previousSuccessRate === null ? '—' : `${skill.trend.previousSuccessRate}%`}</strong>
                        </div>
                      ) : null}
                      {skill.trend.direction === 'insufficient_data' ? (
                        <small>Для сравнения нужны два полных окна по пять ответов.</small>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="skill-not-started">Осваивай навык в доступных миссиях — история появится после первых ответов.</p>
                )}
                {skill.available ? (
                  <div className={`skill-next-step skill-next-step-${dueReview ? 'review' : isDeclining ? 'reinforce' : skill.status === 'mastered' ? 'advance' : 'practice'}`}>
                    <span className="skill-next-step-label">{nextStepTitle}</span>
                    <p className="skill-next-step-reason">{nextStepReason}</p>
                    {nextStepQuests.length ? (
                      <div className="skill-next-step-links">
                        {nextStepQuests.slice(0, 2).map((quest) => (
                          <Link
                            className="skill-next-step-link"
                            href={`/quests/${encodeURIComponent(quest.slug)}`}
                            key={quest.slug}
                          >
                            <span>
                              <strong>{quest.title}</strong>
                              <small>{quest.durationMin} мин · {quest.difficulty ?? 'Любая сложность'}</small>
                            </span>
                            <b aria-hidden="true">→</b>
                          </Link>
                        ))}
                      </div>
                    ) : dueReview ? (
                      <Link className="review-compact-link" href="/review">Открыть план повторения →</Link>
                    ) : skill.status === 'mastered' ? (
                      <p className="skill-not-started">Опубликованной миссии следующей сложности пока нет.</p>
                    ) : (
                      <p className="skill-not-started">Подходящая опубликованная миссия пока не найдена.</p>
                    )}
                  </div>
                ) : null}
                {skill.prerequisites.length ? (
                  <div className="skill-prerequisites">
                    <span>Нужно освоить:</span>
                    {skill.prerequisites.map((prerequisite) => (
                      <span className={prerequisite.mastered ? 'skill-prerequisite mastered' : 'skill-prerequisite'} key={prerequisite.id}>
                        {prerequisite.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                {!skill.available ? <p className="skill-locked-note">Сначала заверши обязательные навыки.</p> : null}
              </article>
            );
          })}
        </div>
      ) : !error ? (
        <div className="profile-empty-inline" role="status">
          Навыки появятся здесь после первых опубликованных учебных миссий.
        </div>
      ) : null}

      {data?.recentEvidence.length ? (
        <div className="skill-evidence-section">
          <div className="skill-evidence-heading">
            <h3>Последние учебные подтверждения</h3>
            <span>{data.recentEvidence.length} последних событий</span>
          </div>
          <div className="skill-evidence-list">
            {data.recentEvidence.slice(0, 5).map((evidence) => (
              <article className="skill-evidence-item" key={evidence.id}>
                <span className={evidence.isCorrect ? 'evidence-indicator correct' : 'evidence-indicator'}>
                  {evidence.isCorrect ? '✓' : '↻'}
                </span>
                <div className="skill-evidence-copy">
                  <strong>{evidence.skillName}</strong>
                  <span>{evidence.questTitle} · {evidence.levelTitle} · задание {evidence.puzzleOrder}</span>
                </div>
                <div className="skill-evidence-meta">
                  <span>{getEvidenceTypeLabel(evidence.evidenceType)}</span>
                  <time dateTime={evidence.occurredAt}>{formatDate(evidence.occurredAt)}</time>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
