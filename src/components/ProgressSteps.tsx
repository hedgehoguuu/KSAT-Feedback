'use client';

import Link from 'next/link';
import { STEPS, TOTAL_STEPS, type StepKey, stepIndex } from '@/config/steps';

type Props = {
  current: StepKey;
  /** 여기까지는 탭해서 되돌아갈 수 있다 (FE-1) */
  reachable: number;
};

export function ProgressSteps({ current, reachable }: Props) {
  const at = stepIndex(current);

  return (
    <nav
      aria-label={`전체 ${TOTAL_STEPS}단계 중 ${at + 1}단계`}
      // 위에 붙어 따라다니는 머리말 — 아래 내용이 지나가므로 유리로 둔다
      className="glass-solid sticky top-0 z-20 border-x-0 border-t-0"
    >
      <ol className="flex items-stretch">
        {STEPS.map((step, i) => {
          const done = i < at;
          const isCurrent = i === at;
          const canGo = i <= Math.min(reachable, at);
          const label = (
            <span className="flex flex-col items-center gap-1.5 py-3">
              <span
                className={[
                  'text-[13px] font-semibold transition-colors',
                  isCurrent ? 'text-foreground' : done ? 'text-brand' : 'text-muted',
                ].join(' ')}
              >
                {step.label}
              </span>
              <span
                aria-hidden
                className={[
                  'h-[3px] w-full rounded-full transition-colors',
                  isCurrent ? 'bg-brand' : done ? 'bg-brand/35' : 'bg-line',
                ].join(' ')}
              />
            </span>
          );

          return (
            <li key={step.key} className="flex-1" aria-current={isCurrent ? 'step' : undefined}>
              {canGo && !isCurrent ? (
                <Link href={step.path} className="block min-h-12 px-1">
                  {label}
                </Link>
              ) : (
                <div className="block min-h-12 px-1">{label}</div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only">{`${TOTAL_STEPS}단계 중 ${at + 1}단계`}</p>
      <p className="px-5 pb-2 text-[11px] text-muted">{`${at + 1} / ${TOTAL_STEPS}단계`}</p>
    </nav>
  );
}
