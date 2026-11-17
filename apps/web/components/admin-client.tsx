'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Identity = { userId: string; email: string; roleKeys: string[]; mfaEnabled: boolean; sessionMfaVerified: boolean };
type Category = { id: string; slug: string; locale: string; title: string; description: string; status: string; sortOrder: number };
type Quest = { id: string; slug: string; status: string; category: { title: string; slug: string }; latestVersion: { versionNo: number; title: string; status: string } | null };
type Audit = { id: string; action: string; entityType: string; entityId: string; createdAt: string; actor: { emailNormalized: string } | null };
const starterLevels = [{ orderNo: 1, title: 'Первый уровень', intro: 'Сюжет и инструкция для игрока.', puzzles: [{ orderNo: 1, type: 'single_choice', maxAttempts: 3, maxScore: 10, publicPayload: { prompt: 'Что продолжает ряд 3, 6, 12?', options: [{ id: 'a', label: '18' }, { id: 'b', label: '24' }, { id: 'c', label: '30' }] }, solutionPrivate: { correctOptionId: 'b', correctFeedback: 'Каждый раз число удваивается.', incorrectFeedback: 'Сравни соседние числа.' }, hints: ['Попробуй умножить последнее число на 2.'] }] }];

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init, credentials: 'include', cache: 'no-store',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const details = Array.isArray(body?.errors) ? ` ${body.errors.join(' ')}` : '';
    throw new Error(`${body?.message ?? body?.error?.message ?? 'Запрос не выполнен.'}${details}`);
  }
  return body as T;
}
function has(identity: Identity | null, ...roles: string[]) {
  return Boolean(identity?.roleKeys.some((role) => roles.includes(role)));
}

export function AdminClient() {
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  const [catTitle, setCatTitle] = useState('');
  const [catSlug, setCatSlug] = useState('');
  const [catDescription, setCatDescription] = useState('Рубрика образовательных миссий по выбранной теме.');
  const [catLocale, setCatLocale] = useState('ru');

  const [categoryId, setCategoryId] = useState('');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [objectives, setObjectives] = useState('Находить закономерности\nОбъяснять ход решения');
  const [skills, setSkills] = useState('logical-reasoning');
  const [ageMin, setAgeMin] = useState('14');
  const [ageMax, setAgeMax] = useState('99');
  const [difficulty, setDifficulty] = useState('beginner');
  const [duration, setDuration] = useState('10');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('/media/add-approved-cover');
  const [coverAlt, setCoverAlt] = useState('');
  const [coverLicense, setCoverLicense] = useState('');
  const [levelsJson, setLevelsJson] = useState(JSON.stringify(starterLevels, null, 2));

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api<{ user: Identity }>('/admin/me');
      setIdentity(result.user);
      const adminNeedsMfa = result.user.roleKeys.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r));
      if (!adminNeedsMfa || (result.user.mfaEnabled && result.user.sessionMfaVerified)) {
        const [cats, qs] = await Promise.all([
          api<Category[]>('/admin/categories'),
          api<Quest[]>('/admin/quests'),
        ]);
        setCategories(cats);
        setQuests(qs);
        setCategoryId((value) => value || cats.find((cat) => cat.status === 'PUBLISHED')?.id || '');
        if (result.user.roleKeys.some((r) => ['REVIEWER', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
          setAudit(await api<Audit[]>('/admin/audit-logs?take=30'));
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Не удалось загрузить CMS.';
      if (/sign in|session has expired/i.test(message)) {
        router.replace(`/login?next=${encodeURIComponent('/admin')}`);
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);

  async function action(work: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); setNotice(success); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Операция не выполнена.'); }
    finally { setBusy(false); }
  }

  async function beginMfa() {
    setBusy(true); setError('');
    try {
      const setup = await api<{ secret: string; instructions: string }>('/admin/mfa/setup', { method: 'POST' });
      setMfaSecret(setup.secret); setNotice(setup.instructions);
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось начать настройку MFA.'); }
    finally { setBusy(false); }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action(() => api('/admin/mfa/verify', { method: 'POST', body: JSON.stringify({ code: mfaCode }) }), 'MFA подтверждена для этой сессии.');
    setMfaSecret(''); setMfaCode('');
  }

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action(() => api('/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ slug: catSlug, title: catTitle, description: catDescription, locale: catLocale }),
    }), 'Рубрика создана. Администратор должен опубликовать её перед созданием квестов.');
    setCatSlug(''); setCatTitle('');
  }

  async function submitQuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let levels: unknown;
    try { levels = JSON.parse(levelsJson); }
    catch { setError('JSON уровней содержит синтаксическую ошибку.'); return; }
    await action(() => api('/admin/quests', {
      method: 'POST',
      body: JSON.stringify({
        categoryId, slug, locale: 'ru', title, summary, description,
        objectives: objectives.split('\n').map((s) => s.trim()).filter(Boolean),
        skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
        ageMin: Number(ageMin), ageMax: Number(ageMax), difficulty, durationMin: Number(duration),
        seo: { title: seoTitle, description: seoDescription },
        coverUrl, coverAlt, coverLicenseSource: coverLicense, levels,
      }),
    }), 'Черновик сохранён. Его можно отправить на рецензирование.');
    setSlug(''); setTitle('');
  }

  function workflow(quest: Quest, state: string) {
    const path = state === 'PUBLISHED' ? 'draft' : state === 'DRAFT' ? 'submit-review' : state === 'REVIEW' ? 'approve' : 'publish';
    const text = { DRAFT: 'Отправлено на рецензию.', REVIEW: 'Версия одобрена.', APPROVED: 'Квест опубликован.', PUBLISHED: 'Новая версия создана.' }[state] ?? 'Готово.';
    void action(() => api(`/admin/quests/${quest.id}/${path}`, { method: 'POST' }), text);
  }

  const isAdmin = has(identity, 'ADMIN', 'SUPER_ADMIN');
  const canAuthor = has(identity, 'AUTHOR', 'REVIEWER', 'ADMIN', 'SUPER_ADMIN');
  const canReview = has(identity, 'REVIEWER', 'ADMIN', 'SUPER_ADMIN');
  const canPublish = isAdmin;

  if (loading) return <main className="admin-page"><p className="muted-copy">Загружаем CMS…</p></main>;
  if (!identity) return <main className="admin-page"><section className="admin-panel"><h1>CMS недоступна</h1><p>{error || 'Войди в аккаунт с назначенной ролью.'}</p><a className="button button-primary" href="/login?next=%2Fadmin">Войти</a></section></main>;
  if (!canAuthor) return <main className="admin-page"><section className="admin-panel"><p className="eyebrow">ДОСТУП ОГРАНИЧЕН</p><h1>Нет роли CMS</h1><p>Попроси администратора назначить роль Author, Reviewer или Admin.</p><p className="small-note">{identity.email}</p>{error && <p className="form-error">{error}</p>}</section></main>;

  if (isAdmin && (!identity.mfaEnabled || !identity.sessionMfaVerified)) {
    return <main className="admin-page"><section className="admin-panel admin-mfa-panel">
      <p className="eyebrow">ЗАЩИТА АДМИНИСТРАТОРА</p><h1>{identity.mfaEnabled ? 'Подтверди MFA' : 'Настрой MFA'}</h1>
      <p className="muted-copy">Для Admin и Super Admin обязательны одноразовые коды TOTP из приложения-аутентификатора.</p>
      {!identity.mfaEnabled && !mfaSecret && <button className="button button-primary" disabled={busy} onClick={() => void beginMfa()} type="button">Создать секрет MFA</button>}
      {(mfaSecret || identity.mfaEnabled) && <form className="admin-form" onSubmit={verifyMfa}>
        {mfaSecret && <label className="field"><span>Секрет (сохрани в приложении-аутентификаторе)</span><textarea rows={3} readOnly value={mfaSecret}/></label>}
        <label className="field"><span>Шестизначный код</span><input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" maxLength={6} pattern="[0-9]{6}" required/></label>
        <button className="button button-primary" disabled={busy || mfaCode.length !== 6} type="submit">Подтвердить</button>
      </form>}
      {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success">{notice}</p>}
    </section></main>;
  }

  return <main className="admin-page">
    <header className="admin-header"><div><p className="eyebrow">QUESTORIA CONTENT STUDIO</p><h1>Управление контентом</h1><p className="muted-copy">{identity.email} · {identity.roleKeys.join(', ')}</p></div><a className="button button-secondary" href="/quests">Открыть каталог</a></header>
    {error && <p className="form-error admin-alert" role="alert">{error}</p>}{notice && <p className="form-success admin-alert" role="status">{notice}</p>}

    <section className="admin-panel">
      <div className="admin-section-title"><div><p className="eyebrow">01 / CATEGORIES</p><h2>Рубрики</h2></div><span className="admin-count">{categories.length}</span></div>
      <div className="admin-list">{categories.map((cat) => <article className="admin-list-row" key={cat.id}>
        <div><strong>{cat.title}</strong><span>{cat.slug} · {cat.locale}</span></div>
        <div className="admin-row-actions"><span className={`admin-status status-${cat.status.toLowerCase()}`}>{cat.status}</span>
          {canPublish && cat.status === 'DRAFT' && <button className="button button-small button-secondary" disabled={busy} onClick={() => void action(() => api(`/admin/categories/${cat.id}/publish`, { method: 'POST' }), 'Рубрика опубликована.')} type="button">Опубликовать</button>}
        </div>
      </article>)}{!categories.length && <p className="admin-empty">Рубрик пока нет.</p>}</div>
      <form className="admin-form admin-form-grid" onSubmit={submitCategory}>
        <label className="field"><span>Название</span><input value={catTitle} onChange={(e) => setCatTitle(e.target.value)} required minLength={2}/></label>
        <label className="field"><span>Slug</span><input value={catSlug} onChange={(e) => setCatSlug(e.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required/></label>
        <label className="field"><span>Язык</span><select value={catLocale} onChange={(e) => setCatLocale(e.target.value)}><option value="ru">Русский</option><option value="de">Deutsch</option><option value="en">English</option></select></label>
        <label className="field admin-field-wide"><span>Описание</span><textarea rows={2} value={catDescription} onChange={(e) => setCatDescription(e.target.value)} required minLength={10}/></label>
        <button className="button button-primary" disabled={busy} type="submit">Создать рубрику</button>
      </form>
    </section>

    <section className="admin-panel">
      <div className="admin-section-title"><div><p className="eyebrow">02 / QUEST LIBRARY</p><h2>Квесты и версии</h2></div><span className="admin-count">{quests.length}</span></div>
      <div className="admin-list">{quests.map((quest) => { const status = quest.latestVersion?.status ?? quest.status; return <article className="admin-list-row admin-quest-row" key={quest.id}>
        <div><strong>{quest.latestVersion?.title ?? quest.slug}</strong><span>{quest.slug} · {quest.category.title} · v{quest.latestVersion?.versionNo ?? '—'}</span></div>
        <div className="admin-row-actions"><span className={`admin-status status-${status.toLowerCase()}`}>{status}</span>
          {status === 'PUBLISHED' && canAuthor && <button className="button button-small button-secondary" disabled={busy} onClick={() => workflow(quest, status)} type="button">Новая версия</button>}
          {status === 'DRAFT' && canAuthor && <button className="button button-small button-secondary" disabled={busy} onClick={() => workflow(quest, status)} type="button">На рецензию</button>}
          {status === 'REVIEW' && canReview && <button className="button button-small button-secondary" disabled={busy} onClick={() => workflow(quest, status)} type="button">Одобрить</button>}
          {status === 'APPROVED' && canPublish && <button className="button button-small button-primary" disabled={busy} onClick={() => workflow(quest, status)} type="button">Опубликовать</button>}
        </div>
      </article>; })}{!quests.length && <p className="admin-empty">Квестов пока нет.</p>}</div>
    </section>

    {canAuthor && <section className="admin-panel">
      <div className="admin-section-title"><div><p className="eyebrow">03 / CONTENT EDITOR</p><h2>Новый квест</h2></div></div>
      <form className="admin-form admin-form-grid" onSubmit={submitQuest}>
        <label className="field admin-field-wide"><span>Опубликованная рубрика</span><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required><option value="">Выбери рубрику</option>{categories.filter((c) => c.status === 'PUBLISHED').map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label className="field"><span>Slug</span><input value={slug} onChange={(e) => setSlug(e.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required/></label>
        <label className="field"><span>Название</span><input value={title} onChange={(e) => setTitle(e.target.value)} minLength={5} required/></label>
        <label className="field admin-field-wide"><span>Краткое описание</span><textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} minLength={20} required/></label>
        <label className="field admin-field-wide"><span>Полное описание</span><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} minLength={50} required/></label>
        <label className="field"><span>Учебные цели (по одной на строку)</span><textarea rows={3} value={objectives} onChange={(e) => setObjectives(e.target.value)} required/></label>
        <label className="field"><span>Навыки (через запятую)</span><input value={skills} onChange={(e) => setSkills(e.target.value)} required/></label>
        <label className="field"><span>Возраст от</span><input type="number" min="14" max="99" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} required/></label>
        <label className="field"><span>Возраст до</span><input type="number" min="14" max="99" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} required/></label>
        <label className="field"><span>Сложность</span><select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="beginner">Начальная</option><option value="intermediate">Средняя</option><option value="advanced">Продвинутая</option></select></label>
        <label className="field"><span>Длительность (мин)</span><input type="number" min="1" max="240" value={duration} onChange={(e) => setDuration(e.target.value)} required/></label>
        <label className="field"><span>SEO title</span><input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} required/></label>
        <label className="field"><span>SEO description</span><input value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} required/></label>
        <label className="field"><span>Cover URL или /media/ path</span><input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} required/></label>
        <label className="field"><span>Alt обложки</span><input value={coverAlt} onChange={(e) => setCoverAlt(e.target.value)} required/></label>
        <label className="field admin-field-wide"><span>Источник лицензии</span><input value={coverLicense} onChange={(e) => setCoverLicense(e.target.value)} required/></label>
        <div className="admin-cover-preview admin-field-wide">
          <div className="admin-cover-preview-image">
            {coverUrl.trim() && (coverUrl.startsWith('/') || coverUrl.startsWith('https://') || coverUrl.startsWith('http://')) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt={coverAlt || 'Предпросмотр обложки квеста'} />
            ) : <span>Q</span>}
          </div>
          <div><p className="eyebrow">LIVE PREVIEW</p><strong>{title || 'Название будущего квеста'}</strong><p>{summary || 'Краткое описание появится здесь.'}</p><small>{coverAlt || 'Alt-текст обложки не задан'} · {coverLicense || 'Источник лицензии не указан'}</small></div>
        </div>
        <label className="field admin-field-wide"><span>Уровни / головоломки (JSON)</span><textarea className="admin-json-editor" rows={18} spellCheck={false} value={levelsJson} onChange={(e) => setLevelsJson(e.target.value)} required/></label>
        <button className="button button-primary" disabled={busy || !categoryId} type="submit">Сохранить черновик</button>
      </form>
    </section>}

    {canReview && <section className="admin-panel">
      <div className="admin-section-title"><div><p className="eyebrow">04 / AUDIT TRAIL</p><h2>Журнал действий</h2></div><span className="admin-count">{audit.length}</span></div>
      <div className="admin-list">{audit.map((entry) => <article className="admin-list-row" key={entry.id}><div><strong>{entry.action}</strong><span>{entry.entityType} · {entry.entityId} · {entry.actor?.emailNormalized ?? 'system'}</span></div><time>{new Date(entry.createdAt).toLocaleString('ru-RU')}</time></article>)}{!audit.length && <p className="admin-empty">Событий пока нет.</p>}</div>
    </section>}
  </main>;
}
