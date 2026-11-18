'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Identity = { userId: string; email: string; roleKeys: string[]; mfaEnabled: boolean; sessionMfaVerified: boolean };
type Category = { id: string; slug: string; locale: string; title: string; description: string; status: string; sortOrder: number };
type Quest = { id: string; slug: string; status: string; category: { title: string; slug: string }; latestVersion: { versionNo: number; title: string; status: string } | null };
type Audit = {
  id: string; action: string; entityType: string; entityId: string;
  reason: string | null; beforeJson: unknown; afterJson: unknown;
  createdAt: string; actor: { emailNormalized: string } | null;
};
type AuditPage = { items: Audit[]; total: number; take: number; skip: number };
type AuditExport = { items: Audit[]; total: number; exported: number; limit: number; truncated: boolean };
type AuditFilters = { q: string; action: string; actor: string; entityType: string; from: string; to: string };
const AUDIT_PAGE_SIZE = 30;

function auditQueryString(filters: AuditFilters, take?: number, skip?: number): string {
  const params = new URLSearchParams();
  if (take !== undefined) params.set('take', String(take));
  if (skip !== undefined) params.set('skip', String(skip));
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim()) params.set(key, value.trim());
  }
  return params.toString();
}

function csvCell(value: unknown): string {
  const raw: string = value === null || value === undefined
    ? ''
    : typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  const safe = /^\s*[=+\-@]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}
type ManagedUser = {
  id: string; email: string; nickname: string | null; status: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
  emailVerified: boolean; mfaEnabled: boolean; createdAt: string; roles: Array<{ key: string; name: string }>;
};
type ManagedSession = {
  id: string; createdAt: string; expiresAt: string; mfaVerified: boolean; isCurrent: boolean;
};
const managedRoleOptions = [
  { key: 'AUTHOR', label: 'Автор' },
  { key: 'REVIEWER', label: 'Рецензент' },
  { key: 'ADMIN', label: 'Администратор' },
  { key: 'SUPER_ADMIN', label: 'Суперадминистратор' },
] as const;
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
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditSkip, setAuditSkip] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditExporting, setAuditExporting] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditActor, setAuditActor] = useState('');
  const [auditEntityType, setAuditEntityType] = useState('');
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleDrafts, setUserRoleDrafts] = useState<Record<string, string>>({});
  const [userReasons, setUserReasons] = useState<Record<string, string>>({});
  const [userSessions, setUserSessions] = useState<Record<string, ManagedSession[]>>({});
  const [expandedSessionUsers, setExpandedSessionUsers] = useState<Record<string, boolean>>({});
  const [sessionLoading, setSessionLoading] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [showRecoveryInput, setShowRecoveryInput] = useState(false);
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');
  const [recoveryTotpCode, setRecoveryTotpCode] = useState('');
  const [recoveryCodeCount, setRecoveryCodeCount] = useState(0);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

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
        const [cats, qs, members] = await Promise.all([
          api<Category[]>('/admin/categories'),
          api<Quest[]>('/admin/quests'),
          result.user.roleKeys.includes('SUPER_ADMIN')
            ? api<ManagedUser[]>('/admin/users')
            : Promise.resolve([] as ManagedUser[]),
        ]);
        setCategories(cats);
        setQuests(qs);
        setManagedUsers(members);
        if (result.user.mfaEnabled && result.user.sessionMfaVerified) {
          const recoveryStatus = await api<{ remaining: number }>('/admin/mfa/recovery-codes/status');
          setRecoveryCodeCount(recoveryStatus.remaining);
        } else {
          setRecoveryCodeCount(0);
        }
        setCategoryId((value) => value || cats.find((cat) => cat.status === 'PUBLISHED')?.id || '');
        if (result.user.roleKeys.some((r) => ['REVIEWER', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
          const auditPage = await api<AuditPage>('/admin/audit-logs?take=' + AUDIT_PAGE_SIZE + '&skip=0');
          setAudit(auditPage.items);
          setAuditTotal(auditPage.total);
          setAuditSkip(auditPage.skip);
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

  async function action(work: () => Promise<unknown>, success: string): Promise<unknown> {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await work();
      setNotice(success);
      await load();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Операция не выполнена.');
      return undefined;
    } finally {
      setBusy(false);
    }
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
    const result = await action(
      () => api<{ recoveryCodes?: string[]; recoveryCodesRemaining?: number }>('/admin/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ code: mfaCode }),
      }),
      'MFA подтверждена для этой сессии.',
    ) as { recoveryCodes?: string[]; recoveryCodesRemaining?: number } | undefined;
    if (result?.recoveryCodes?.length) {
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryCodeCount(result.recoveryCodesRemaining ?? result.recoveryCodes.length);
      setNotice('MFA включена. Сохрани резервные коды сейчас: они больше не будут показаны.');
    }
    setMfaSecret(''); setMfaCode('');
  }

  async function useRecoveryCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action(
      () => api('/admin/mfa/recovery-codes/use', {
        method: 'POST',
        body: JSON.stringify({ code: recoveryCodeInput }),
      }),
      'Резервный код принят. MFA подтверждена для этой сессии.',
    );
    setRecoveryCodeInput('');
    setShowRecoveryInput(false);
  }

  async function regenerateRecoveryCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action(
      () => api<{ codes: string[]; remaining: number }>('/admin/mfa/recovery-codes/regenerate', {
        method: 'POST',
        body: JSON.stringify({ code: recoveryTotpCode }),
      }),
      'Резервные коды обновлены. Старый набор больше не работает.',
    ) as { codes: string[]; remaining: number } | undefined;
    if (result) {
      setRecoveryCodes(result.codes);
      setRecoveryCodeCount(result.remaining);
    }
    setRecoveryTotpCode('');
  }

  async function copyRecoveryCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setNotice('Резервные коды скопированы.');
    } catch {
      setError('Не удалось скопировать коды. Выдели их и скопируй вручную.');
    }
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


  async function assignManagedRole(user: ManagedUser) {
    const role = userRoleDrafts[user.id] ?? 'AUTHOR';
    const reason = userReasons[user.id]?.trim() ?? '';
    if (reason.length < 5) {
      setError('Укажи причину изменения роли (минимум 5 символов).');
      return;
    }
    await action(() => api(`/admin/users/${user.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ role, reason }),
    }), `Роль ${role} назначена: ${user.email}.`);
  }

  async function revokeManagedRole(user: ManagedUser, role: string) {
    const reason = userReasons[user.id]?.trim() ?? '';
    if (reason.length < 5) {
      setError('Укажи причину изменения роли (минимум 5 символов).');
      return;
    }
    await action(() => api(`/admin/users/${user.id}/roles/${role}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    }), `Роль ${role} снята с ${user.email}.`);
  }

  async function toggleManagedUserStatus(user: ManagedUser) {
    const reason = userReasons[user.id]?.trim() ?? '';
    if (reason.length < 5) {
      setError('Укажи причину изменения статуса (минимум 5 символов).');
      return;
    }
    const status = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    await action(() => api(`/admin/users/${user.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    }), status === 'SUSPENDED'
      ? `Аккаунт ${user.email} приостановлен, активные сессии завершены.`
      : `Аккаунт ${user.email} снова активен. Пользователю нужно войти заново.`);
  }

  async function loadManagedSessions(userId: string) {
    setSessionLoading((current) => ({ ...current, [userId]: true }));
    try {
      const result = await api<{ sessions: ManagedSession[] }>('/admin/users/' + userId + '/sessions');
      setUserSessions((current) => ({ ...current, [userId]: result.sessions }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить сессии пользователя.');
    } finally {
      setSessionLoading((current) => ({ ...current, [userId]: false }));
    }
  }

  async function toggleManagedSessions(user: ManagedUser) {
    const expanded = Boolean(expandedSessionUsers[user.id]);
    setExpandedSessionUsers((current) => ({ ...current, [user.id]: !expanded }));
    if (!expanded && userSessions[user.id] === undefined) {
      await loadManagedSessions(user.id);
    }
  }

  async function revokeManagedSession(user: ManagedUser, session: ManagedSession) {
    const reason = userReasons[user.id]?.trim() ?? '';
    if (reason.length < 5) {
      setError('Укажи причину отзыва сессии (минимум 5 символов).');
      return;
    }
    await action(() => api('/admin/users/' + user.id + '/sessions/' + session.id, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    }), 'Сессия пользователя ' + user.email + ' завершена.');
    if (expandedSessionUsers[user.id]) await loadManagedSessions(user.id);
  }

  async function revokeOtherManagedSessions(user: ManagedUser) {
    const reason = userReasons[user.id]?.trim() ?? '';
    if (reason.length < 5) {
      setError('Укажи причину отзыва сессий (минимум 5 символов).');
      return;
    }
    await action(() => api('/admin/users/' + user.id + '/sessions/revoke-others', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }), 'Остальные сессии пользователя ' + user.email + ' завершены.');
    if (expandedSessionUsers[user.id]) await loadManagedSessions(user.id);
  }

  function currentAuditFilters(): AuditFilters {
    return {
      q: auditSearch,
      action: auditAction,
      actor: auditActor,
      entityType: auditEntityType,
      from: auditFrom,
      to: auditTo,
    };
  }

  async function loadAuditPage(skip = 0, filters = currentAuditFilters()) {
    setAuditLoading(true);
    setError('');
    try {
      const query = auditQueryString(filters, AUDIT_PAGE_SIZE, skip);
      const result = await api<AuditPage>('/admin/audit-logs?' + query);
      setAudit(result.items);
      setAuditTotal(result.total);
      setAuditSkip(result.skip);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить журнал действий.');
    } finally {
      setAuditLoading(false);
    }
  }

  async function resetAuditFilters() {
    const empty: AuditFilters = { q: '', action: '', actor: '', entityType: '', from: '', to: '' };
    setAuditSearch('');
    setAuditAction('');
    setAuditActor('');
    setAuditEntityType('');
    setAuditFrom('');
    setAuditTo('');
    await loadAuditPage(0, empty);
  }

  async function exportAuditLogs() {
    setAuditExporting(true);
    setError('');
    try {
      const query = auditQueryString(currentAuditFilters());
      const result = await api<AuditExport>('/admin/audit-logs/export' + (query ? '?' + query : ''));
      const headers = ['createdAt', 'actorEmail', 'action', 'entityType', 'entityId', 'reason', 'beforeJson', 'afterJson'];
      const rows = result.items.map((entry) => [
        entry.createdAt,
        entry.actor?.emailNormalized ?? 'system',
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.reason ?? '',
        entry.beforeJson,
        entry.afterJson,
      ]);
      const csv = '\uFEFF' + [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'questoria-audit-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(result.truncated
        ? 'Выгружено ' + result.exported + ' из ' + result.total + ' записей. Экспорт ограничен 5 000 событиями.'
        : 'Выгружено записей: ' + result.exported + '.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось экспортировать журнал действий.');
    } finally {
      setAuditExporting(false);
    }
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
  const isSuperAdmin = has(identity, 'SUPER_ADMIN');
  const visibleManagedUsers = managedUsers.filter((user) => {
    const term = userSearch.trim().toLocaleLowerCase('ru-RU');
    return !term || user.email.toLocaleLowerCase('ru-RU').includes(term)
      || (user.nickname ?? '').toLocaleLowerCase('ru-RU').includes(term)
      || user.roles.some((role) => role.name.toLocaleLowerCase('ru-RU').includes(term));
  });

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
      {identity.mfaEnabled && <div className="admin-mfa-recovery-login">
        <button className="button button-secondary" type="button" onClick={() => setShowRecoveryInput((value) => !value)}>
          {showRecoveryInput ? 'Вернуться к коду приложения' : 'Нет доступа к приложению? Использовать резервный код'}
        </button>
        {showRecoveryInput && <form className="admin-form" onSubmit={useRecoveryCode}>
          <label className="field"><span>Одноразовый резервный код</span>
            <input value={recoveryCodeInput} onChange={(event) => setRecoveryCodeInput(event.target.value)} autoComplete="one-time-code" minLength={24} maxLength={30} required placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"/>
          </label>
          <button className="button button-primary" disabled={busy || recoveryCodeInput.replace(/[\s-]/g, '').length !== 24} type="submit">Подтвердить резервным кодом</button>
        </form>}
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success">{notice}</p>}
    </section></main>;
  }

  return <main className="admin-page">
    <header className="admin-header"><div><p className="eyebrow">QUESTORIA CONTENT STUDIO</p><h1>Управление контентом</h1><p className="muted-copy">{identity.email} · {identity.roleKeys.join(', ')}</p></div><a className="button button-secondary" href="/quests">Открыть каталог</a></header>
    {error && <p className="form-error admin-alert" role="alert">{error}</p>}{notice && <p className="form-success admin-alert" role="status">{notice}</p>}

    <nav className="admin-section-nav" aria-label="Навигация по разделам CMS">
      {identity.mfaEnabled && identity.sessionMfaVerified && <a href="#admin-security">Безопасность</a>}
      {isSuperAdmin && <a href="#admin-users">Пользователи и роли</a>}
      <a href="#admin-categories">Рубрики</a>
      <a href="#admin-quests">Квесты и версии</a>
      {canAuthor && <a href="#admin-editor">Новый квест</a>}
      {canReview && <a href="#admin-audit">Журнал аудита</a>}
    </nav>

    {identity.mfaEnabled && identity.sessionMfaVerified && <section id="admin-security" className="admin-panel admin-mfa-recovery-panel">
      <div className="admin-section-title">
        <div><p className="eyebrow">ACCOUNT SECURITY</p><h2>Резервные коды MFA</h2>
          <p className="admin-section-description">Осталось кодов: <strong>{recoveryCodeCount}</strong>. Каждый код можно применить только один раз.</p>
        </div>
        <span className="admin-count">{recoveryCodeCount}</span>
      </div>
      <form className="admin-form admin-mfa-regenerate-form" onSubmit={regenerateRecoveryCodes}>
        <label className="field"><span>Текущий код из приложения-аутентификатора</span>
          <input value={recoveryTotpCode} onChange={(event) => setRecoveryTotpCode(event.target.value)} inputMode="numeric" maxLength={6} pattern="[0-9]{6}" required placeholder="123456"/>
        </label>
        <button className="button button-secondary" type="submit" disabled={busy || recoveryTotpCode.length !== 6}>Создать новый набор из 10 кодов</button>
      </form>
      {recoveryCodes.length > 0 && <div className="admin-recovery-codes">
        <p className="form-success">Сохрани эти коды в надёжном месте. После закрытия этого блока показать их снова будет нельзя.</p>
        <div className="admin-recovery-code-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>
        <div className="admin-row-actions">
          <button className="button button-small button-secondary" type="button" onClick={() => void copyRecoveryCodes()}>Скопировать все коды</button>
          <button className="button button-small button-secondary" type="button" onClick={() => setRecoveryCodes([])}>Скрыть коды</button>
        </div>
      </div>}
    </section>}

    {isSuperAdmin && <section id="admin-users" className="admin-panel admin-users-panel">
      <div className="admin-section-title">
        <div><p className="eyebrow">01 / USER ACCESS</p><h2>Пользователи и роли</h2><p className="admin-section-description">Управление доступом доступно только Super Admin после подтверждения MFA.</p></div>
        <span className="admin-count">{managedUsers.length}</span>
      </div>
      <label className="field admin-user-search"><span>Поиск пользователя</span><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Email, имя или роль"/></label>
      <div className="admin-user-list">
        {visibleManagedUsers.map((user) => {
          const isSelf = user.id === identity.userId;
          const assignedKeys = new Set(user.roles.map((role) => role.key));
          const availableRoles = managedRoleOptions.filter((role) => !assignedKeys.has(role.key));
          return (
            <article className="admin-user-card" key={user.id}>
              <div className="admin-user-heading">
                <div className="admin-user-avatar">{(user.nickname || user.email).slice(0, 1).toUpperCase()}</div>
                <div className="admin-user-identity">
                  <strong>{user.nickname || user.email}</strong>
                  <span>{user.email}</span>
                  <small>Создан {new Date(user.createdAt).toLocaleDateString('ru-RU')}</small>
                </div>
                <span className={`admin-status status-${user.status.toLowerCase()}`}>{user.status === 'ACTIVE' ? 'Активен' : user.status === 'SUSPENDED' ? 'Приостановлен' : 'Ожидает'}</span>
              </div>
              <div className="admin-user-trust">
                <span className={user.emailVerified ? 'admin-trust-good' : 'admin-trust-muted'}>{user.emailVerified ? '✓ Email подтверждён' : '· Email не подтверждён'}</span>
                <span className={user.mfaEnabled ? 'admin-trust-good' : 'admin-trust-muted'}>{user.mfaEnabled ? '✓ MFA включена' : '· MFA не включена'}</span>
              </div>
              <div className="admin-user-roles">
                {user.roles.length ? user.roles.map((role) => (
                  <span className="admin-role-chip" key={role.key}>{role.name}
                    {!isSelf && <button type="button" disabled={busy} onClick={() => void revokeManagedRole(user, role.key)} aria-label={`Снять роль ${role.name} у ${user.email}`}>×</button>}
                  </span>
                )) : <span className="admin-no-role">Без ролей CMS</span>}
              </div>
              <div className="admin-session-controls">
                <div className="admin-session-toolbar">
                  <button className="button button-small button-secondary" type="button" disabled={busy || sessionLoading[user.id]} onClick={() => void toggleManagedSessions(user)}>
                    {expandedSessionUsers[user.id] ? 'Скрыть сессии' : 'Активные сессии'}
                  </button>
                  {expandedSessionUsers[user.id] && (userSessions[user.id] ?? []).some((session) => !session.isCurrent) && (
                    <button className="button button-small button-danger" type="button" disabled={busy} onClick={() => void revokeOtherManagedSessions(user)}>
                      {isSelf ? 'Завершить остальные' : 'Завершить все сессии'}
                    </button>
                  )}
                </div>
                {expandedSessionUsers[user.id] && <div className="admin-session-list">
                  <label className="field admin-session-reason"><span>Причина отзыва (минимум 5 символов)</span>
                    <input value={userReasons[user.id] ?? ''} onChange={(event) => setUserReasons((current) => ({ ...current, [user.id]: event.target.value }))} placeholder="Например: завершение подозрительных входов"/>
                  </label>
                  {sessionLoading[user.id] && <p className="admin-empty">Загружаем сессии…</p>}
                  {!sessionLoading[user.id] && (userSessions[user.id] ?? []).map((session) => (
                    <article className="admin-session-row" key={session.id}>
                      <div>
                        <strong>{session.isCurrent ? 'Текущая сессия' : 'Активная сессия'}</strong>
                        <span>Создана {new Date(session.createdAt).toLocaleString('ru-RU')} · действует до {new Date(session.expiresAt).toLocaleString('ru-RU')}</span>
                        <small>{session.mfaVerified ? 'MFA подтверждена' : 'MFA в этой сессии не подтверждена'}</small>
                      </div>
                      {session.isCurrent
                        ? <span className="admin-current-session">Текущая</span>
                        : <button className="button button-small button-danger" type="button" disabled={busy} onClick={() => void revokeManagedSession(user, session)}>Завершить</button>}
                    </article>
                  ))}
                  {!sessionLoading[user.id] && !(userSessions[user.id] ?? []).length && <p className="admin-empty">Активных сессий нет.</p>}
                </div>}
              </div>
              {!isSelf && <div className="admin-user-management">
                <label className="field"><span>Назначить роль</span>
                  <select value={userRoleDrafts[user.id] ?? availableRoles[0]?.key ?? ''} onChange={(event) => setUserRoleDrafts((current) => ({ ...current, [user.id]: event.target.value }))} disabled={!availableRoles.length || busy}>
                    {availableRoles.length ? availableRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>) : <option value="">Все роли назначены</option>}
                  </select>
                </label>
                <label className="field admin-reason-field"><span>Причина изменения (от 5 символов)</span>
                  <input value={userReasons[user.id] ?? ''} onChange={(event) => setUserReasons((current) => ({ ...current, [user.id]: event.target.value }))} placeholder="Например: назначение редактора"/>
                </label>
                <div className="admin-user-actions">
                  <button className="button button-small button-secondary" type="button" disabled={busy || !availableRoles.length} onClick={() => void assignManagedRole(user)}>Назначить роль</button>
                  <button className={user.status === 'ACTIVE' ? 'button button-small button-danger' : 'button button-small button-primary'} type="button" disabled={busy || user.status === 'PENDING'} onClick={() => void toggleManagedUserStatus(user)}>{user.status === 'ACTIVE' ? 'Приостановить' : 'Активировать'}</button>
                </div>
              </div>}
              {isSelf && <p className="admin-self-note">Это твой аккаунт. Изменять собственные роли и статус здесь нельзя.</p>}
            </article>
          );
        })}
        {!visibleManagedUsers.length && <p className="admin-empty">{managedUsers.length ? 'По запросу ничего не найдено.' : 'Пользователей пока нет.'}</p>}
      </div>
      <p className="admin-users-footnote">Защита от блокировки: нельзя изменить собственный доступ или удалить/приостановить последнего активного Super Admin. Приостановка аккаунта завершает все его сессии. Все изменения записываются в журнал аудита с указанной причиной.</p>
    </section>}

    <section id="admin-categories" className="admin-panel">
      <div className="admin-section-title"><div><p className="eyebrow">02 / CATEGORIES</p><h2>Рубрики</h2></div><span className="admin-count">{categories.length}</span></div>
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

    <section id="admin-quests" className="admin-panel">
      <div className="admin-section-title"><div><p className="eyebrow">03 / QUEST LIBRARY</p><h2>Квесты и версии</h2></div><span className="admin-count">{quests.length}</span></div>
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

    {canAuthor && <section id="admin-editor" className="admin-panel">
      <div className="admin-section-title"><div><p className="eyebrow">04 / CONTENT EDITOR</p><h2>Новый квест</h2></div></div>
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

    {canReview && <section id="admin-audit" className="admin-panel admin-audit-panel">
      <div className="admin-section-title">
        <div><p className="eyebrow">05 / AUDIT TRAIL</p><h2>Журнал действий</h2>
          <p className="admin-section-description">Поиск по событиям, пользователям и объектам. Даты фильтруются по UTC.</p>
        </div>
        <span className="admin-count">{auditTotal}</span>
      </div>
      <form className="admin-form admin-audit-filters" onSubmit={(event) => { event.preventDefault(); void loadAuditPage(0); }}>
        <label className="field admin-audit-search"><span>Поиск по журналу</span><input type="search" value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} placeholder="Событие, email, ID объекта или причина"/></label>
        <label className="field"><span>Тип события</span><input value={auditAction} onChange={(event) => setAuditAction(event.target.value)} placeholder="Например security.mfa"/></label>
        <label className="field"><span>Пользователь (email)</span><input type="search" value={auditActor} onChange={(event) => setAuditActor(event.target.value)} placeholder="admin@example.com"/></label>
        <label className="field"><span>Тип объекта</span>
          <select value={auditEntityType} onChange={(event) => setAuditEntityType(event.target.value)}>
            <option value="">Все объекты</option><option value="USER">Пользователь</option><option value="QUEST">Квест</option><option value="CATEGORY">Рубрика</option>
          </select>
        </label>
        <label className="field"><span>С даты (UTC)</span><input type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)}/></label>
        <label className="field"><span>По дату (UTC)</span><input type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)}/></label>
        <div className="admin-audit-actions">
          <button className="button button-primary button-small" type="submit" disabled={auditLoading}>Применить фильтры</button>
          <button className="button button-secondary button-small" type="button" disabled={auditLoading} onClick={() => void resetAuditFilters()}>Сбросить</button>
          <button className="button button-secondary button-small" type="button" disabled={auditExporting} onClick={() => void exportAuditLogs()}>{auditExporting ? 'Готовим CSV…' : 'Экспорт CSV'}</button>
        </div>
      </form>
      {auditLoading && <p className="admin-empty">Загружаем события…</p>}
      {!auditLoading && <div className="admin-list admin-audit-list">
        {audit.map((entry) => <article className="admin-audit-row" key={entry.id}>
          <div className="admin-audit-heading">
            <div><strong>{entry.action}</strong><span>{entry.entityType} · {entry.entityId} · {entry.actor?.emailNormalized ?? 'system'}</span></div>
            <time>{new Date(entry.createdAt).toLocaleString('ru-RU')}</time>
          </div>
          {entry.reason && <p className="admin-audit-reason">Причина: {entry.reason}</p>}
          {(entry.beforeJson != null || entry.afterJson != null) && <details className="admin-audit-details">
            <summary>Подробности изменения</summary>
            <pre>{JSON.stringify({ before: entry.beforeJson, after: entry.afterJson }, null, 2)}</pre>
          </details>}
        </article>)}
        {!audit.length && <p className="admin-empty">По заданным условиям событий нет.</p>}
      </div>}
      <div className="admin-audit-pagination">
        <span>{auditTotal === 0 ? 'Нет записей' : 'Показано ' + (auditSkip + 1) + '–' + Math.min(auditSkip + audit.length, auditTotal) + ' из ' + auditTotal}</span>
        <div>
          <button className="button button-small button-secondary" type="button" disabled={auditLoading || auditSkip === 0} onClick={() => void loadAuditPage(Math.max(0, auditSkip - AUDIT_PAGE_SIZE))}>Назад</button>
          <button className="button button-small button-secondary" type="button" disabled={auditLoading || auditSkip + audit.length >= auditTotal} onClick={() => void loadAuditPage(auditSkip + AUDIT_PAGE_SIZE)}>Далее</button>
        </div>
      </div>
    </section>}
  </main>;
}
