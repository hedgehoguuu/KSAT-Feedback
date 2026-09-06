'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ProgressSteps } from '@/components/ProgressSteps';
import { ExamSummary } from '@/components/ExamSummary';
import { STEPS, stepByPath, stepIndex } from '@/config/steps';
import { useApply, useHydrated } from '@/lib/store';

export default function ApplyLayout({ children }: LayoutProps<'/apply'>) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();

  // 안전망. 저장소 문제는 safeStorage 가 받아내지만, 그래도 복원이 안 끝나는 브라우저가
  // 있다면 학생은 "불러오는 중…" 에 갇힌다. 3초면 정상적인 복원은 진작 끝나 있다.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 3000);
    return () => clearTimeout(timer);
  }, []);
  const ready = hydrated || waited;

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
    if (!ready) return;
    // 제출 직후에는 완료 화면으로 넘어가는 중이다. 여기서 되돌리면 완료 화면을 못 본다.
    if (justCompleted) return;
    if (at > reachable) router.replace(STEPS[reachable].path);
    else markPath(pathname);
  }, [ready, at, reachable, pathname, router, markPath, justCompleted]);

  return (
    <>
      <ProgressSteps current={step.key} reachable={reachable} />
      {step.key !== 'exam' ? <ExamSummary /> : null}
      {ready ? (
        children
      ) : (
        <div className="flex flex-1 items-center justify-center p-10 text-[14px] text-muted">
          불러오는 중…
        </div>
      )}
    </>
  );
}
