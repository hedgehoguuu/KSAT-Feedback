'use client';

import Link from 'next/link';
import { findExam } from '@/config/exams';
import { useApply } from '@/lib/store';

/** 고른 시험이 이후 화면 상단에 계속 보인다 (FE-2 AC) */
export function ExamSummary() {
  const examCode = useApply((s) => s.examCode);
  const exam = findExam(examCode);
  if (!exam) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-2.5">
      <span className="truncate text-[13px] font-semibold text-foreground">{exam.shortLabel}</span>
      <Link href="/apply/exam" className="shrink-0 text-[13px] text-muted underline underline-offset-2">
        바꾸기
      </Link>
    </div>
  );
}
