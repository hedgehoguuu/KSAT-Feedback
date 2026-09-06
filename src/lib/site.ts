/**
 * 이 배포의 주소. 절대 주소가 필요한 곳이 네 군데다 — 링크 미리보기(metadataBase),
 * 알림 메일 속 링크, robots, sitemap. 각자 만들면 언젠가 한 곳만 달라진다.
 *
 * robots·sitemap 은 빌드할 때 한 번 계산된다. Vercel 은 빌드 중에도
 * VERCEL_PROJECT_PRODUCTION_URL 을 넣어 주므로 그대로 맞는다.
 * 나중에 직접 산 도메인을 붙이면 SITE_URL 에 그 주소를 넣으면 된다 — 그 값이 먼저다.
 */
export function siteUrl(): string | null {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return host ? `https://${host}` : null;
}
