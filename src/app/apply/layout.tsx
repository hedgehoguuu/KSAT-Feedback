'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ProgressSteps } from '@/components/ProgressSteps';
import { ExamSummary } from '@/components/ExamSummary';
import { STEPS, stepByPath, stepIndex } from '@/config/steps';
import { useApply, useHydrated } from '@/lib/store';

export default function ApplyLayout({ children }: LayoutProps<'/apply'>) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();

  const examCode = useApply((s) => s.examCode);
  const photos = useApply((s) => s.photos);
  const justCompleted = useApply((s) => s.justCompleted);
  const markPath = useApply((s) => s.markPath);

  const step = stepByPath(pathname) ?? STEPS[0];
  const at = stepIndex(step.key);

  // 업로드가 끝난 사진이 한 장이라도 있어야 ③④로 갈 수 있다 (FE-3 AC)
  const hasUpload = photos.some((p) => p.status === 'done');
  const reachable = hasUpload ? 3 : examCode ? 1 : 0;

  useEffect(() => {
    if (!hydrated) return;
    // 제출 직후에는 완료 화면으로 넘어가는 중이다. 여기서 되돌리면 완료 화면을 못 본다.
    if (justCompleted) return;
    if (at > reachable) router.replace(STEPS[reachable].path);
    else markPath(pathname);
  }, [hydrated, at, reachable, pathname, router, markPath, justCompleted]);

  return (
    <>
      <ProgressSteps current={step.key} reachable={reachable} />
      {step.key !== 'exam' ? <ExamSummary /> : null}
      {hydrated ? (
        children
      ) : (
        <div className="flex flex-1 items-center justify-center p-10 text-[14px] text-muted">
          불러오는 중…
        </div>
      )}
    </>
  );
}
