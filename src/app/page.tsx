'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { POLICY } from '@/config/app';
import { useIntake } from '@/lib/useIntake';
import { clearDraftId } from '@/lib/draft';
import { STEPS } from '@/config/steps';
import { hasProgress, useApply, useHydrated } from '@/lib/store';

const BADGES = ['무료', '이름 안 물어봐요', '1주일 안에 이메일로'];

export default function Landing() {
  const router = useRouter();
  const hydrated = useHydrated();
  const intake = useIntake();
  const state = useApply();
  const resume = hydrated && hasProgress(state);

  function startOver() {
    state.reset();
    clearDraftId();
    router.push(STEPS[0].path);
  }

  if (!intake.loading && !intake.open) {
    return (
      <main className="flex flex-1 flex-col justify-center px-5 py-16">
        <h1 className="text-[24px] font-bold leading-[1.35]">{intake.reason}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          생각보다 많은 분이 보내주셔서, 지금 받은 시험지부터 꼼꼼히 볼게요. 다음 회차는 곧 알려드릴게요.
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col px-5 pb-10 pt-16">
      <h1 className="text-[28px] font-bold leading-[1.35]">
        9월 모의고사,
        <br />
        시험지만 보내주세요
      </h1>
      <p className="mt-4 text-[16px] leading-[1.6] text-muted">
        어디서 시간이 샜는지, 왜 그 문제에서 막혔는지. 시대인재 TA 형·누나들이 직접 보고 알려드릴게요.
      </p>

      <ul className="mt-6 flex flex-wrap gap-2">
        {BADGES.map((b) => (
          <li key={b} className="rounded-full bg-surface px-3 py-1.5 text-[13px] font-semibold text-muted">
            {b}
          </li>
        ))}
      </ul>

      {resume ? (
        <div className="mt-8 rounded-2xl border border-brand/30 bg-brand/5 p-4">
          <p className="text-[15px] font-bold">이어서 하실래요?</p>
          <p className="mt-1 text-[13px] text-muted">쓰던 내용이 그대로 남아 있어요.</p>
          <div className="mt-3 flex gap-2">
            <Link
              href={state.lastPath ?? STEPS[0].path}
              className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-brand text-[15px] font-bold text-white active:bg-brand-pressed"
            >
              이어서 하기
            </Link>
            <button
              type="button"
              onClick={startOver}
              className="min-h-12 rounded-xl bg-surface px-4 text-[15px] font-semibold text-muted active:bg-line"
            >
              처음부터
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-auto pt-10">
        <Link
          href={STEPS[0].path}
          className="flex min-h-13 w-full items-center justify-center rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
        >
          시험지 보내기
        </Link>
        <p className="mt-2 text-center text-[13px] text-muted">2분이면 끝나요</p>
        <p className="mt-6 text-center text-[12px] leading-relaxed text-muted">
          이메일 말고는 아무것도 안 물어봐요. 보내주신 사진은 분석이 끝나고 {POLICY.retentionDays}일 뒤에 지워요.
        </p>
      </div>
    </main>
  );
}
