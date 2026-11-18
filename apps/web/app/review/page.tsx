import type { Metadata } from 'next';
import { ReviewQueueClient } from '../../components/review-queue';

export const metadata: Metadata = {
  title: 'Повторение навыков',
  robots: { index: false, follow: false },
};

export default function ReviewPage() {
  return <ReviewQueueClient />;
}
