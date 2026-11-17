import Link from 'next/link';
import { AuthAction } from '../../components/auth-action';

export const metadata = {
  title: 'Подтверждение почты',
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark">Q</span>
        <span>questoria</span>
      </Link>
      <section className="auth-card">
        <p className="eyebrow">ПОСЛЕДНИЙ ШАГ РЕГИСТРАЦИИ</p>
        <h1>Добро пожаловать</h1>
        <p className="muted-copy">Подтверди адрес электронной почты, чтобы включить аккаунт и начать проходить квесты.</p>
        <AuthAction mode="verify" token={token} />
      </section>
      <Link className="back-link" href="/quests">← Вернуться к квестам</Link>
    </main>
  );
}
