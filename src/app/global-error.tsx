'use client';

import { useEffect } from 'react';

/**
 * 최상위 레이아웃 자체가 터졌을 때. error.tsx 도 못 그리는 상황이라
 * 이 파일이 <html> 부터 직접 그린다.
 *
 * 이 화면이 뜨는 순간에는 전역 CSS·글꼴을 못 믿는다. 그래서 클래스 이름을 쓰지 않고
 * 인라인 스타일만 쓴다 — 마지막 안전망은 아무것에도 기대지 않아야 한다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error.digest ?? '', error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 20px',
          background: '#fff',
          color: '#191f28',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif',
          wordBreak: 'keep-all',
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.35, margin: 0 }}>
          잠시 문제가 생겼어요
        </h1>
        <p style={{ marginTop: 12, fontSize: 15, lineHeight: 1.7, color: '#8b95a1' }}>
          저희 쪽 문제예요. 잠시 뒤 다시 시도해주세요.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 28,
            minHeight: 52,
            border: 0,
            borderRadius: 16,
            background: '#3182f6',
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            fontFamily: 'inherit',
          }}
        >
          다시 시도하기
        </button>
        {error.digest ? (
          <p style={{ marginTop: 16, fontSize: 12, color: '#8b95a1' }}>오류 번호 {error.digest}</p>
        ) : null}
      </body>
    </html>
  );
}
