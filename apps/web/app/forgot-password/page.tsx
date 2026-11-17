import Link from 'next/link';
import { AuthAction } from '../../components/auth-action';

export const metadata = {
  title: 'Восстановление пароля',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark">Q</span>
        <span>questoria</span>
      </Link>
      <section className="auth-card">
        <p className="eyebrow">ВОЗВРАЩАЕМ ДОСТУП</p>
        <h1>Забыл пароль?</h1>
        <p className="muted-copy">Укажи адрес аккаунта. Если он существует и подтверждён, мы отправим ссылку для смены пароля.</p>
        <AuthAction mode="forgot" />
      </section>
      <Link className="back-link" href="/quests">← Вернуться к квестам</Link>
    </main>
  );
}
