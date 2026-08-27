'use client';

import { useRouter } from 'next/navigation';
import { EXAMS, findExam, type ExamCode } from '@/config/exams';
import { subjectLabel } from '@/config/subjects';
import { useApply } from '@/lib/store';

export default function ExamStep() {
  const router = useRouter();
  const examCode = useApply((s) => s.examCode);
  const setExam = useApply((s) => s.setExam);

  function choose(code: ExamCode) {
    if (examCode && examCode !== code) {
      const allowed = new Set(findExam(code)?.subjects ?? []);
      const { photos, concerns } = useApply.getState();
      const dropped = new Set(
        [...photos.map((p) => p.subject), ...(Object.keys(concerns) as (keyof typeof concerns)[])]
          .filter((s) => s && !allowed.has(s))
          .map(String),
      );
      if (dropped.size > 0) {
        const names = [...dropped].map((c) => subjectLabel(c as never)).join(', ');
        const ok = window.confirm(
          `시험을 바꾸면 ${names}에 올린 내용은 지워져요. 그래도 바꿀까요?`,
        );
        if (!ok) return;
      }
    }
    setExam(code);
    // 별도 '다음' 버튼 없이 바로 넘어간다 (FE-2 AC)
    router.push('/apply/upload');
  }

  const open = EXAMS.filter((e) => e.enabled);

  return (
    <main className="flex flex-1 flex-col px-5 pb-10 pt-7">
      <h1 className="text-[24px] font-bold leading-[1.35]">어떤 시험을 봤어요?</h1>
      <p className="mt-2 text-[15px] text-muted">고르면 학년은 알아서 정해져요.</p>

      <ul className="mt-7 flex flex-col gap-3">
        {open.map((exam) => {
          const selected = exam.code === examCode;
          return (
            <li key={exam.code}>
              <button
                type="button"
                onClick={() => choose(exam.code)}
                aria-pressed={selected}
                className={[
                  'flex min-h-[76px] w-full flex-col items-start justify-center gap-1 rounded-2xl border px-5 py-4 text-left transition-colors',
                  selected
                    ? 'border-brand bg-brand/5'
                    : 'border-line bg-background active:bg-surface',
                ].join(' ')}
              >
                <span className="text-[17px] font-bold">{exam.title}</span>
                <span className="text-[14px] text-muted">{exam.subtitle}</span>
                <span className="mt-1 text-[13px] text-muted">
                  {exam.subjects.map((s) => subjectLabel(s)).join(' · ')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-[13px] leading-relaxed text-muted">
        여기 없는 시험은 아직 못 받아요. 다음 회차에 열게요.
      </p>
    </main>
  );
}
