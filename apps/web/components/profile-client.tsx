'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ReviewQueuePreview, type ReviewQueueResponse } from './review-queue.js';
import { SkillProgressSection, type PlayerSkillsResponse } from './skill-progress-section.js';

interface ProfileData {
  id: string;
  nickname: string | null;
  locale: string;
  user: { email: string };
  wallet: { xp: number; coins: number };
  stats: { completedQuests: number; completedRuns: number; activeRuns: number; completedLevels: number };
  progression: {
    level: number; totalXp: number; xpIntoLevel: number; xpForNextLevel: number;
    xpToNextLevel: number; progressPercent: number; unlockedAchievements: number;
    achievements: Array<{ id: string; title: string; description: string; icon: string; unlocked: boolean }>;
  };
}

interface ProgressData {
  stats: {
    completedQuests: number;
    completedRuns: number;
    activeRuns: number;
    completedLevels: number;
  };
  recentRuns: Array<{
    id: string;
    slug: string;
    title: string;
    status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
    score: number;
    completedLevels: number;
    startedAt: string;
    completedAt: string | null;
    lastActivityAt: string;
  }>;
}

interface WalletEntry {
  id: string;
  currency: 'XP' | 'COIN';
  amount: number;
  reason: string;
  sourceType: string;
  createdAt: string;
}

interface WalletData {
  balances: { xp: number; coins: number };
  entries: WalletEntry[];
}


async function fetchJson(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message ?? data.error?.message ?? 'Не удалось загрузить профиль.');
    Object.assign(error, { status: response.status });
    throw error;
  }
  return data;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function ProfileClient() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [skillsData, setSkillsData] = useState<PlayerSkillsResponse | null>(null);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueResponse | null>(null);
  const [skillsError, setSkillsError] = useState('');
  const [reviewQueueError, setReviewQueueError] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadProfile = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const [profileData, progressData, walletData] = await Promise.all([
        fetchJson('/me/profile') as Promise<ProfileData>,
        fetchJson('/me/progress') as Promise<ProgressData>,
        fetchJson('/me/wallet') as Promise<WalletData>,
      ]);
      setProfile(profileData);
      setProgress(progressData);
      setWallet(walletData);
      setNickname(profileData.nickname ?? '');

      // Learning data is additive: a temporary failure in the new endpoints
      // must not hide the core profile, wallet or mission history.
      const [skillsResult, reviewResult] = await Promise.allSettled([
        fetchJson('/me/skills') as Promise<PlayerSkillsResponse>,
        fetchJson('/me/review-queue') as Promise<ReviewQueueResponse>,
      ]);
      const unauthorized = [skillsResult, reviewResult].some(
        (result) => result.status === 'rejected'
          && result.reason instanceof Error
          && 'status' in result.reason
          && result.reason.status === 401,
      );
      if (unauthorized) {
        router.replace('/login?next=%2Fprofile');
        return;
      }

      if (skillsResult.status === 'fulfilled') {
        setSkillsData(skillsResult.value);
        setSkillsError('');
      } else {
        setSkillsData(null);
        setSkillsError('Не удалось загрузить карту навыков. Обнови профиль чуть позже.');
      }

      if (reviewResult.status === 'fulfilled') {
        setReviewQueue(reviewResult.value);
        setReviewQueueError('');
      } else {
        setReviewQueue(null);
        setReviewQueueError('Очередь повторения временно недоступна.');
      }
    } catch (loadError) {
      if (loadError instanceof Error && 'status' in loadError && loadError.status === 401) {
        router.replace('/login?next=%2Fprofile');
        return;
      }
      setError(loadError instanceof Error ? loadError.message : 'Сервер временно недоступен.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadProfile();
    });
  }, [loadProfile]);

  async function logout() {
    setSaving(true);
    setError('');
    try {
      await fetchJson('/auth/logout', { method: 'POST' });
      router.replace('/');
      router.refresh();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : 'Не удалось завершить сессию.');
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await fetchJson('/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname.trim() || null }),
      });
      setNotice('Имя профиля сохранено.');
      await loadProfile();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить профиль.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="profile-page profile-loading" aria-busy="true">
        <header className="topbar profile-topbar">
          <Link className="brand" href="/">
            <span className="brand-mark">Q</span><span>questoria</span>
          </Link>
          <Link className="simple-nav-link" href="/quests">К квестам</Link>
        </header>
        <section className="profile-loading-heading" aria-hidden="true">
          <span className="profile-skeleton-avatar" />
          <span className="profile-skeleton-lines"><i /><i /></span>
        </section>
        <p className="muted-copy" role="status">Загружаем твой прогресс и историю миссий…</p>
        <div className="profile-loading-grid" aria-hidden="true">
          <span /><span /><span /><span />
        </div>
      </main>
    );
  }

  if (!profile || !progress || !wallet) {
    return (
      <main className="profile-page">
        <header className="topbar profile-topbar">
          <Link className="brand" href="/">
            <span className="brand-mark">Q</span><span>questoria</span>
          </Link>
          <Link className="simple-nav-link" href="/quests">К квестам</Link>
        </header>
        <section className="profile-empty">
          <p className="eyebrow">ПРОФИЛЬ</p>
          <h1>Не удалось открыть профиль</h1>
          <p className="muted-copy" role="alert">{error || 'Проверь соединение и попробуй ещё раз.'}</p>
          <button className="button button-primary" onClick={() => void loadProfile(true)} type="button">
            Повторить загрузку
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="profile-page">
      <header className="topbar profile-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">Q</span><span>questoria</span>
        </Link>
        <nav className="simple-nav" aria-label="Основная навигация">
          <Link href="/quests">Квесты</Link>
          <Link href="/profile" aria-current="page">Профиль</Link>
          <button className="button button-secondary button-logout" type="button" disabled={saving} onClick={() => void logout()}>Выйти</button>
        </nav>
      </header>

      <section className="profile-heading">
        <div className="profile-avatar">{(profile.nickname || profile.user.email).slice(0, 1).toUpperCase()}</div>
        <div>
          <p className="eyebrow">ТВОЙ ПРОГРЕСС</p>
          <h1>{profile.nickname || 'Исследователь'}</h1>
          <p className="muted-copy">{profile.user.email}</p>
          <span className="level-pill">УРОВЕНЬ {profile.progression.level}</span>
        </div>
      </section>

      <section className="player-level-card" aria-label="Уровень игрока">
        <div className="player-level-heading">
          <div><p className="eyebrow">ТВОЙ УРОВЕНЬ</p><h2>Исследователь · уровень {profile.progression.level}</h2></div>
          <strong>{profile.progression.totalXp.toLocaleString('ru-RU')} XP</strong>
        </div>
        <div className="xp-progress-track" role="progressbar" aria-valuenow={profile.progression.progressPercent} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${profile.progression.xpIntoLevel} из ${profile.progression.xpForNextLevel} XP на текущем уровне`} aria-label="Прогресс до следующего уровня">
          <span style={{ width: `${profile.progression.progressPercent}%` }} />
        </div>
        <p>{profile.progression.xpIntoLevel} / {profile.progression.xpForNextLevel} XP на этом уровне · ещё {profile.progression.xpToNextLevel} XP до следующего</p>
      </section>

      <section className="economy-grid" aria-label="Баланс и достижения">
        <article className="economy-card xp-card">
          <span className="economy-icon">✦</span>
          <span className="economy-label">ОПЫТ</span>
          <strong>{wallet.balances.xp.toLocaleString('ru-RU')} XP</strong>
          <p>Накопленный опыт — растёт с каждой миссией</p>
        </article>
        <article className="economy-card coin-card">
          <span className="economy-icon">◈</span>
          <span className="economy-label">МОНЕТЫ</span>
          <strong>{wallet.balances.coins.toLocaleString('ru-RU')}</strong>
          <p>Внутренняя валюта для будущих косметических наград</p>
        </article>
      </section>

      <section className="profile-stats" aria-label="Статистика прохождений">
        <article><strong>{progress.stats.completedQuests}</strong><span>Первых прохождений</span></article>
        <article><strong>{progress.stats.completedRuns}</strong><span>Завершённых сессий</span></article>
        <article><strong>{progress.stats.activeRuns}</strong><span>Активных миссий</span></article>
        <article><strong>{progress.stats.completedLevels}</strong><span>Пройденных этапов</span></article>
      </section>

      <ReviewQueuePreview data={reviewQueue} error={reviewQueueError} />
      <SkillProgressSection data={skillsData} error={skillsError} />

      <section className="profile-section achievement-section">
        <div className="profile-section-heading">
          <div><p className="eyebrow">ТВОИ ДОСТИЖЕНИЯ</p><h2>Значки исследователя</h2></div>
          <span className="achievement-count">{profile.progression.unlockedAchievements} / {profile.progression.achievements.length}</span>
        </div>
        {profile.progression.achievements.length ? (
          <div className="achievement-grid">
          {profile.progression.achievements.map((achievement) => (
            <article className={achievement.unlocked ? 'achievement-card unlocked' : 'achievement-card locked'} key={achievement.id}>
              <span className="achievement-icon">{achievement.unlocked ? achievement.icon : '◇'}</span>
              <div><strong>{achievement.title}</strong><p>{achievement.description}</p></div>
              <span className="achievement-state">{achievement.unlocked ? 'Получено' : 'Впереди'}</span>
            </article>
          ))}
          </div>
        ) : (
          <div className="profile-empty-inline" role="status">
            Достижения появятся здесь, когда ты завершишь первые этапы и миссии.
          </div>
        )}
      </section>

      <div className="profile-columns">
        <section className="profile-section">
          <div className="profile-section-heading">
            <div>
              <p className="eyebrow">ТВОЯ ИСТОРИЯ</p>
              <h2>Недавние миссии</h2>
            </div>
            <Link className="text-link" href="/quests">К квестам →</Link>
          </div>
          {progress.recentRuns.length ? (
            <div className="history-list">
              {progress.recentRuns.map((run) => (
                <article className="history-item" key={run.id}>
                  <span className={run.status === 'COMPLETED' ? 'history-symbol done' : 'history-symbol'}>
                    {run.status === 'COMPLETED' ? '✓' : '✧'}
                  </span>
                  <div className="history-copy">
                    <strong>{run.title}</strong>
                    <span>{formatDate(run.lastActivityAt)} · {run.score} баллов</span>
                  </div>
                  {run.status === 'IN_PROGRESS' ? (
                    <Link className="history-action" href={`/play/${run.id}`}>Продолжить</Link>
                  ) : (
                    <span className="history-status">
                      {run.status === 'COMPLETED' ? 'Завершён' : 'Попытки исчерпаны'}
                    </span>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="profile-empty-inline">
              <p>Здесь появятся твои первые прохождения.</p>
              <Link className="text-link" href="/quests">Выбрать первый квест →</Link>
            </div>
          )}
        </section>

        <section className="profile-section wallet-section">
          <div className="profile-section-heading">
            <div>
              <p className="eyebrow">LEDGER</p>
              <h2>История наград</h2>
            </div>
          </div>
          {wallet.entries.length ? (
            <div className="ledger-list">
              {wallet.entries.map((entry) => (
                <article className="ledger-item" key={entry.id}>
                  <div>
                    <strong>{entry.reason}</strong>
                    <span>{formatDate(entry.createdAt)}</span>
                  </div>
                  <span className={entry.amount >= 0 ? 'ledger-amount positive' : 'ledger-amount'}>
                    {entry.amount > 0 ? '+' : ''}{entry.amount} {entry.currency === 'XP' ? 'XP' : 'монет'}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="profile-empty-inline">Пока нет операций с балансом.</p>
          )}
        </section>
      </div>

      <section className="profile-section profile-edit">
        <div>
          <p className="eyebrow">НАСТРОЙКИ</p>
          <h2>Имя профиля</h2>
          <p className="muted-copy">Измени имя, которое отображается в Questoria.</p>
        </div>
        <form className="profile-edit-form" onSubmit={saveProfile}>
          <label className="field">
            <span>Имя или псевдоним</span>
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              minLength={2}
              maxLength={30}
              placeholder="Исследователь"
            />
          </label>
          <button className="button button-primary" disabled={saving} type="submit">
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
        {notice && <p className="form-success" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
