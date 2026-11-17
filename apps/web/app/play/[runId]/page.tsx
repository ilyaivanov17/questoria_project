import { PlayClient } from '../../../components/play-client';

export const metadata = {
  title: 'Игровая миссия',
  robots: { index: false, follow: false },
};

export default async function PlayPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <PlayClient runId={runId} />;
}
