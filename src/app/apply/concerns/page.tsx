'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { filledSubjects } from '@/lib/flow';
import { useApply } from '@/lib/store';

/** ③단계 입구 — 첫 과목으로 넘긴다. 과목별 화면은 /apply/concerns/[subject] */
export default function ConcernsEntry() {
  const router = useRouter();
  const examCode = useApply((s) => s.examCode);
  const subjects = useApply((s) => s.subjects);
  const photos = useApply((s) => s.photos);

  const targets = filledSubjects(examCode, subjects, photos);

  useEffect(() => {
    router.replace(targets.length > 0 ? `/apply/concerns/${targets[0]}` : '/apply/upload');
  }, [router, targets]);

  return <div className="flex flex-1 items-center justify-center p-10 text-[14px] text-muted">잠시만요…</div>;
}
