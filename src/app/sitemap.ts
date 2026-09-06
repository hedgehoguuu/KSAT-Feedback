import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

/**
 * 검색엔진에 알리는 주소 목록. 사람이 처음 닿아야 하는 두 곳만 넣는다 —
 * 접수 흐름의 중간 단계나 신청 화면은 혼자 열려도 쓸모가 없다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = siteUrl();
  if (!site) return [];

  const now = new Date();
  return [
    { url: `${site}/`, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${site}/class`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
  ];
}
