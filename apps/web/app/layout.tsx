import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Questoria — знания становятся приключением',
    template: '%s | Questoria',
  },
  description:
    'Образовательные квесты, логические задачи и небольшие миссии для развития мышления.',
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
