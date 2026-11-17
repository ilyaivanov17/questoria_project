'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';

type AuthActionMode = 'verify' | 'forgot' | 'reset';

interface AuthActionProps {
  mode: AuthActionMode;
  token?: string;
}

const COPY = {
  verify: {
    button: 'Подтвердить почту',
    title: 'Подтверждение адреса',
  },
  forgot: {
    button: 'Отправить ссылку',
    title: 'Восстановление пароля',
  },
  reset: {
    button: 'Сохранить новый пароль',
    title: 'Новый пароль',
  },
} satisfies Record<AuthActionMode, { button: string; title: string }>;

export function AuthAction({ mode, token = '' }: AuthActionProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');

    if ((mode === 'verify' || mode === 'reset') && !token) {
      setError('В ссылке нет токена. Запроси новое письмо.');
      return;
    }

    setBusy(true);
    const endpoint =
      mode === 'verify'
        ? 'verify-email'
        : mode === 'forgot'
          ? 'forgot-password'
          : 'reset-password';
    const body =
      mode === 'verify'
        ? { token }
        : mode === 'forgot'
          ? { email }
          : { token, password };

    try {
      const response = await fetch('/api/v1/auth/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? data.error?.message ?? 'Не удалось выполнить запрос.');
      }
      setNotice(
        data.message ??
          (mode === 'forgot'
            ? 'Если аккаунт существует, письмо будет отправлено.'
            : 'Готово.'),
      );
      setPassword('');
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Не удалось связаться с сервером. Попробуй ещё раз.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>{COPY[mode].title}</h2>
      {mode === 'verify' && !token ? (
        <p className="form-error" role="alert">В ссылке отсутствует токен подтверждения. Запроси письмо повторно со страницы регистрации.</p>
      ) : (
        <>
          {!notice && (
            <form className="auth-form" onSubmit={handleSubmit}>
              {mode === 'forgot' && (
                <label className="field">
                  <span>Электронная почта</span>
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
              )}
              {mode === 'reset' && (
                <label className="field">
                  <span>Новый пароль</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Не менее 12 символов"
                  />
                </label>
              )}
              <button className="button button-primary submit-button" type="submit" disabled={busy}>
                {busy ? 'Подождите…' : COPY[mode].button}
              </button>
            </form>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="form-success" role="status">{notice}</p>}
          {mode === 'reset' && notice && (
            <p className="muted-copy">Все прежние сессии завершены. Войди заново с новым паролем.</p>
          )}
        </>
      )}
      <p className="auth-switch">
        <Link href="/login">Вернуться ко входу</Link>
      </p>
    </>
  );
}
