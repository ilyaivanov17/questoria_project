import { ProfileClient } from '../../components/profile-client';

export const metadata = {
  title: 'Мой профиль',
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return <ProfileClient />;
}
