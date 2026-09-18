'use client';

import { getDraftId } from './draft';
import { filledSubjects } from './flow';
import { useApply } from './store';

export type SubmitResult = { receiptNo: string; dueDate: string };

/** 학생이 적은 원점수 문자열을 정수로. 비었거나 숫자가 아니면 null. */
function parseScore(raw: string | undefined): number | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * 저장소에서 지워진 사진을 '안 올라감' 으로 돌린다. 올린 지 하루가 지나도록 접수가 안 끝난 사진은
 * 크론이 지운다 — 며칠 뒤 이어하기로 돌아온 학생이다. 그 사진만 다시 고르면 되고, 적어 둔 고민과
 * 이메일은 그대로다. 사진이 하나도 안 남으면 레이아웃이 사진 올리기 단계로 데려간다.
 */
function markExpired(missing: string[]): string {
  const gone = new Set(missing);
  const s = useApply.getState();
  const hit = s.photos.filter((p) => p.storagePath && gone.has(p.storagePath));
  for (const p of hit) {
    s.patchPhoto(p.id, { status: 'error', progress: 0, storagePath: undefined, error: '저장소에서 지워졌어요' });
  }
  return `올린 지 오래된 사진 ${hit.length || missing.length}장이 지워졌어요. 사진 올리기 단계에서 그 사진만 다시 골라주세요 — 적어 둔 고민과 이메일은 그대로예요.`;
}

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
      // 안 적었거나 숫자가 아니면 안 보낸다. 서버가 빈 값을 '없음' 으로 저장한다.
      rawScore: parseScore(s.scores[code]),
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
    if (res.status === 409 && detail?.error === 'UPLOAD_EXPIRED' && Array.isArray(detail.missing)) {
      throw new Error(markExpired(detail.missing as string[]));
    }
    throw new Error(detail?.error ?? '제출이 안 됐어요');
  }

  return (await res.json()) as SubmitResult;
}
