'use client';

import { useRouter } from 'next/navigation';
import { BottomBar } from '@/components/BottomBar';
import { SubjectChips } from '@/components/SubjectChips';
import { UploadSection } from '@/components/UploadSection';
import { LIMITS } from '@/config/app';
import { findExam } from '@/config/exams';
import { subjectLabel, type SubjectCode } from '@/config/subjects';
import { photosOf, useApply } from '@/lib/store';
import { useIntake } from '@/lib/useIntake';

export default function UploadStep() {
  const router = useRouter();
  const examCode = useApply((s) => s.examCode);
  const subjects = useApply((s) => s.subjects);
  const photos = useApply((s) => s.photos);
  const toggleSubject = useApply((s) => s.toggleSubject);
  const intake = useIntake();

  const exam = findExam(examCode);
  if (!exam) return null;

  // 운영에서 꺼 둔 과목은 아예 보이지 않는다 (OPS-1)
  const available = exam.subjects.filter((code) => !intake.disabledSubjects.includes(code));

  // 칩 순서가 아니라 시험에 정의된 과목 순서대로 섹션을 편다
  const openSections = exam.subjects.filter((code) => subjects.includes(code));
  const busy = photos.some((p) => p.status === 'queued' || p.status === 'uploading');
  const uploaded = photos.filter((p) => p.status === 'done').length;
  const canGo = !busy && openSections.some((code) => photosOf(photos, code).some((p) => p.status === 'done'));

  function onToggle(code: SubjectCode) {
    const has = photosOf(photos, code).length > 0;
    if (subjects.includes(code) && has) {
      const ok = window.confirm(`${subjectLabel(code)}에 올린 사진도 같이 지워져요. 뺄까요?`);
      if (!ok) return;
    }
    toggleSubject(code);
  }

  const reason = busy
    ? null
    : openSections.length === 0
      ? '올릴 과목을 골라주세요'
      : !canGo
        ? '사진을 한 장 이상 올려주세요'
        : null;

  return (
    <>
      <main className="flex flex-1 flex-col gap-5 px-5 pb-6 pt-7">
        <header>
          <h1 className="text-[24px] font-bold leading-[1.35]">시험지를 올려주세요</h1>
          <p className="mt-2 text-[15px] text-muted">한 과목만 올려도 괜찮아요.</p>
        </header>

        <div>
          <p className="mb-2.5 text-[14px] font-semibold text-muted">올릴 과목을 골라주세요</p>
          <SubjectChips available={available} selected={subjects} onToggle={onToggle} />
        </div>

        {openSections.map((code) => (
          <UploadSection key={code} subject={code} />
        ))}

        {openSections.length > 0 ? (
          <p className="text-[12px] text-muted">
            과목당 {LIMITS.maxPhotosPerSubject}장, 전체 {LIMITS.maxPhotosTotal}장까지 올릴 수 있어요.
            {uploaded > 0 ? ` 지금까지 ${uploaded}장.` : ''}
          </p>
        ) : null}
      </main>

      <BottomBar
        label={busy ? '사진 올리는 중이에요' : '다음'}
        onClick={() => router.push('/apply/concerns')}
        disabled={!canGo}
        reason={reason}
      />
    </>
  );
}
