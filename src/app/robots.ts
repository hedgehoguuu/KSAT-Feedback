import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

/**
 * 검색엔진에게 어디를 보고 어디를 보지 말라고 알려준다.
 *
 * 모집 페이지는 걸려야 하고, 운영 화면(/admin·/setup)과 학생 개인 화면
 * (/done/{접수번호} — 주소에 접수번호가 들어간다)은 걸리면 안 된다.
 * 각 화면에도 noindex 를 붙여 뒀지만, 크롤러가 들어오기 전에 막는 편이 낫다.
 */
export default function robots(): MetadataRoute.Robots {
  const site = siteUrl();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/setup', '/done/', '/api/'],
    },
    ...(site ? { sitemap: `${site}/sitemap.xml` } : {}),
  };
}
