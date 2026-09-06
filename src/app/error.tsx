'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { BRANDING } from '@/config/app';

/**
 * 화면을 그리다 예외가 터졌을 때 대신 나오는 자리.
 *
 * 이게 없으면 Next 기본 화면("Application error: a server-side exception has
 * occurred")이 영어로 뜬다. 수강료를 넣으려던 학부모가 그 문장을 보면 그대로 닫는다.
 * 무엇이 잘못됐는지는 못 알려줘도, 다음에 무엇을 하면 되는지는 알려줄 수 있다.
 */
export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 원인은 서버 로그에서 본다. digest 로 그 요청을 찾아갈 수 있다.
    console.error('[error]', error.digest ?? '', error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-16">
      <h1 className="text-[24px] font-bold leading-[1.35]">잠시 문제가 생겼어요</h1>
      <p className="mt-3 text-[15px] leading-[1.7] text-muted">
        저희 쪽 문제예요. 잠시 뒤 다시 시도해주세요.
      </p>

      <button
        type="button"
        onClick={reset}
        className="mt-7 flex min-h-13 items-center justify-center rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
      >
        다시 시도하기
      </button>
      <Link
        href="/class"
        className="glass mt-3 flex min-h-13 items-center justify-center rounded-2xl text-[15px] font-bold"
      >
        수업 소개로 가기
      </Link>

      <p className="mt-8 text-[13px] leading-[1.7] text-muted">
        계속 이러면 알려주세요. 바로 확인할게요.
        <a
          href={`mailto:${BRANDING.contactEmail}?subject=${encodeURIComponent('[오류] 화면이 안 열려요')}`}
          className="mt-1 block font-bold text-brand underline underline-offset-2"
        >
          {BRANDING.contactEmail}
        </a>
      </p>
      {error.digest ? (
        <p className="mt-4 text-[12px] text-muted">오류 번호 {error.digest}</p>
      ) : null}
    </main>
  );
}
