import Link from 'next/link';
import { AuthForm } from '../../components/auth-form';

export const metadata = {
  title: 'Регистрация',
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark">Q</span>
        <span>questoria</span>
      </Link>
      <section className="auth-card">
        <p className="eyebrow">ТВОЁ ПРИКЛЮЧЕНИЕ НАЧИНАЕТСЯ ЗДЕСЬ</p>
        <h1>Создать аккаунт</h1>
        <p className="muted-copy">Сохраняй прохождения и возвращайся к миссиям в любое время.</p>
        <AuthForm mode="register" />
        <p className="auth-switch">
          Уже зарегистрирован? <Link href="/login">Войти</Link>
        </p>
      </section>
      <Link className="back-link" href="/quests">← Вернуться к квестам</Link>
    </main>
  );
}
