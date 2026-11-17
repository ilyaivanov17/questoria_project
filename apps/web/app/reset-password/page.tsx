import Link from 'next/link';
import { AuthAction } from '../../components/auth-action';

export const metadata = {
  title: 'Новый пароль',
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
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
        <p className="eyebrow">БЕЗОПАСНОСТЬ АККАУНТА</p>
        <h1>Придумай новый пароль</h1>
        <p className="muted-copy">Ссылка действует 30 минут и используется только один раз. После смены пароля все активные сессии завершатся.</p>
        <AuthAction mode="reset" token={token} />
      </section>
      <Link className="back-link" href="/quests">← Вернуться к квестам</Link>
    </main>
  );
}
