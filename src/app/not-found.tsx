import Link from 'next/link';

/** 없는 주소. 막다른 길에 세워 두지 않고 두 갈래를 준다. */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-16">
      <h1 className="text-[24px] font-bold leading-[1.35]">없는 주소예요</h1>
      <p className="mt-3 text-[15px] leading-[1.7] text-muted">
        주소가 바뀌었거나, 잘못 눌린 것 같아요.
      </p>

      <Link
        href="/class"
        className="mt-7 flex min-h-13 items-center justify-center rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
      >
        열려 있는 반 보기
      </Link>
      <Link
        href="/"
        className="glass mt-3 flex min-h-13 items-center justify-center rounded-2xl text-[15px] font-bold"
      >
        시험지 피드백 신청하기
      </Link>
    </main>
  );
}
