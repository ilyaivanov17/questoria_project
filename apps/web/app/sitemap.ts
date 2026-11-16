import type { MetadataRoute } from 'next';

const apiBase = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

interface Category {
  quests: Array<{ slug: string }>;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const response = await fetch(`${apiBase}/api/v1/public/categories`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error('Catalog is unavailable.');

    const categories = (await response.json()) as Category[];
    const quests = categories.flatMap((category) => category.quests);

    return [
      { url: siteUrl, changeFrequency: 'weekly', priority: 1 },
      { url: `${siteUrl}/quests`, changeFrequency: 'daily', priority: 0.9 },
      ...quests.map((quest) => ({
        url: `${siteUrl}/quests/${encodeURIComponent(quest.slug)}`,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      })),
    ];
  } catch {
    return [
      { url: siteUrl, changeFrequency: 'weekly', priority: 1 },
      { url: `${siteUrl}/quests`, changeFrequency: 'daily', priority: 0.9 },
    ];
  }
}
