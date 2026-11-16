import Link from 'next/link';
import { AuthForm } from '../../components/auth-form';

export const metadata = {
  title: 'Вход',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark">Q</span>
        <span>questoria</span>
      </Link>
      <section className="auth-card">
        <p className="eyebrow">СНОВА РАДЫ ТЕБЯ ВИДЕТЬ</p>
        <h1>Войти в Questoria</h1>
        <p className="muted-copy">Продолжи исследование с того места, где остановился.</p>
        <AuthForm mode="login" />
        <p className="auth-switch">
          Ещё нет аккаунта? <Link href="/register">Создать аккаунт</Link>
        </p>
      </section>
      <Link className="back-link" href="/quests">← Вернуться к квестам</Link>
    </main>
  );
}
