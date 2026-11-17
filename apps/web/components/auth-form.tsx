'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type AuthMode = 'login' | 'register';

interface AuthFormProps {
  mode: AuthMode;
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);

    try {
      const response = await fetch('/api/v1/auth/' + mode, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(isRegister ? { nickname } : {}),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? data.error?.message ?? 'Не удалось выполнить запрос.');
      }

      if (isRegister) {
        setNotice(data.message ?? 'Проверь почту и подтверди адрес электронной почты.');
        setPassword('');
        return;
      }

      const next = new URLSearchParams(window.location.search).get('next');
      router.push(next?.startsWith('/') ? next : '/quests');
      router.refresh();
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

  async function handleResendVerification() {
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/v1/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? 'Не удалось отправить письмо.');
      }
      setNotice(data.message ?? 'Если аккаунту требуется подтверждение, письмо будет отправлено.');
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : 'Не удалось отправить письмо. Попробуй ещё раз.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="auth-form" onSubmit={handleSubmit}>
        {isRegister && (
          <label className="field">
            <span>Как к тебе обращаться?</span>
            <input
              autoComplete="nickname"
              maxLength={30}
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="Имя или псевдоним"
            />
          </label>
        )}
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
        <label className="field">
          <span>Пароль</span>
          <input
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
            minLength={12}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Не менее 12 символов"
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-success" role="status">{notice}</p>}
        <button className="button button-primary submit-button" disabled={busy} type="submit">
          {busy ? 'Подождите…' : isRegister ? 'Создать аккаунт' : 'Войти'}
        </button>
        {isRegister && notice && (
          <button
            className="button button-secondary submit-button"
            disabled={busy}
            onClick={handleResendVerification}
            type="button"
          >
            {busy ? 'Отправляем…' : 'Отправить письмо повторно'}
          </button>
        )}
      </form>
      {!isRegister && (
        <p className="auth-switch">
          <Link href="/forgot-password">Забыли пароль?</Link>
        </p>
      )}
    </>
  );
}
