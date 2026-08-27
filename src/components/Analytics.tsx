'use client';

import { Analytics as VercelAnalytics } from '@vercel/analytics/next';

/**
 * Vercel Web Analytics (P1-4 퍼널 계측).
 *
 * 단계마다 주소가 다르므로 페이지뷰만으로 퍼널이 그려진다:
 *   / → /apply/exam → /apply/upload → /apply/concerns/[과목] → /apply/email → /done
 *
 * 완료 화면 주소에는 접수번호가 들어간다. 그대로 보내면 접수 건마다 다른 주소가 쌓이고,
 * 외부 분석 도구에 접수 식별자가 남는다. "최소 개인정보"(SEC-1) 약속에 맞게 잘라서 보낸다.
 */
export function Analytics() {
  return (
    <VercelAnalytics
      beforeSend={(event) => ({
        ...event,
        url: event.url.replace(/\/done\/[^/?#]+/, '/done'),
      })}
    />
  );
}
