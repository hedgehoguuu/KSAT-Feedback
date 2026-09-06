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
  // targets 는 매 렌더 새로 만들어지는 배열이다. 그대로 두면 렌더마다 효과가 다시 돌아
  // replace 를 반복해서 부른다. 실제로 달라지는 값(첫 과목)만 본다.
  const first = targets[0];

  useEffect(() => {
    router.replace(first ? `/apply/concerns/${first}` : '/apply/upload');
  }, [router, first]);

  return <div className="flex flex-1 items-center justify-center p-10 text-[14px] text-muted">잠시만요…</div>;
}
