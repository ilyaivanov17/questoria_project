import { AdminClient } from '../../components/admin-client';

export const metadata = {
  title: 'CMS · Questoria',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminClient />;
}
