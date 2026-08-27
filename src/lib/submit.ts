'use client';

import { getDraftId } from './draft';
import { filledSubjects } from './flow';
import { useApply } from './store';

export type SubmitResult = { receiptNo: string; dueDate: string };

/** 지금 스토어에 있는 내용을 그대로 제출한다 (BE-2). 멱등키를 붙여 재시도해도 접수는 1건이다. */
export async function submitApplication(): Promise<SubmitResult> {
  const s = useApply.getState();
  const targets = filledSubjects(s.examCode, s.subjects, s.photos);

  const payload = {
    idempotencyKey: s.ensureSubmitKey(),
    draftId: getDraftId(),
    examCode: s.examCode,
    email: s.email.trim(),
    consent: s.consent,
    ageOk: s.ageOk,
    subjects: targets.map((code) => ({
      subjectCode: code,
      concerns: s.concerns[code] ?? {},
      files: s.photos
        .filter((p) => p.subject === code && p.status === 'done' && p.storagePath)
        .map((p, i) => ({ storagePath: p.storagePath!, orderIndex: i, bytes: p.bytes })),
    })),
  };

  const res = await fetch('/api/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? '제출이 안 됐어요');
  }

  return (await res.json()) as SubmitResult;
}
