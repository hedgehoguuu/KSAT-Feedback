import { NextResponse, after } from 'next/server';
import { LIMITS, POLICY, formatReceiptNo, replyDueDate } from '@/config/app';
import { findExam, isExamCode } from '@/config/exams';
import { isSubjectCode } from '@/config/subjects';
import { isValidEmail } from '@/lib/email';
import { readIntake } from '@/lib/intake';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processSubmission } from '@/lib/worker/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// PDF 병합·Notion 등록·메일 발송이 응답 뒤에 이어진다. 기본 10초로는 모자란다.
export const maxDuration = 60;

type FileIn = { storagePath: string; orderIndex: number; bytes?: number };
type SubjectIn = { subjectCode: string; concerns: Record<string, string>; files: FileIn[] };
type Body = {
  idempotencyKey?: string;
  examCode?: string;
  email?: string;
  consent?: boolean;
  ageOk?: boolean;
  subjects?: SubjectIn[];
};

/** Supabase 없이 로컬에서 돌릴 때 쓰는 임시 접수번호 발급기 (프로세스 메모리) */
const mockSeq = new Map<string, number>();
const mockIssued = new Map<string, string>();

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad('invalid json');
  }

  const { idempotencyKey, examCode, email, consent, ageOk, subjects } = body;

  if (!idempotencyKey || !/^[a-zA-Z0-9-]{8,64}$/.test(idempotencyKey)) return bad('invalid idempotencyKey');
  if (!examCode || !isExamCode(examCode)) return bad('invalid examCode');
  if (!email || !isValidEmail(email)) return bad('invalid email');
  if (consent !== true) return bad('consent required');
  if (ageOk !== true) return bad('age confirmation required');
  if (!Array.isArray(subjects) || subjects.length === 0) return bad('no subjects');

  const exam = findExam(examCode)!;
  const allowed = new Set(exam.subjects);

  // 접수 스위치는 화면뿐 아니라 서버에서도 확인한다 (OPS-1)
  const intake = await readIntake();
  if (!intake.open) return bad(intake.reason, 409);

  let totalFiles = 0;
  const seen = new Set<string>();
  for (const s of subjects) {
    if (!s || !isSubjectCode(s.subjectCode)) return bad('invalid subject');
    if (!allowed.has(s.subjectCode)) return bad('subject not in exam');
    if (intake.disabledSubjects.includes(s.subjectCode)) return bad('subject closed', 409);
    if (seen.has(s.subjectCode)) return bad('duplicate subject');
    seen.add(s.subjectCode);

    if (!Array.isArray(s.files) || s.files.length === 0) return bad('subject has no files');
    if (s.files.length > LIMITS.maxPhotosPerSubject) return bad('too many files for subject');
    for (const f of s.files) {
      if (!f?.storagePath || typeof f.storagePath !== 'string') return bad('invalid file');
      if (!Number.isInteger(f.orderIndex)) return bad('invalid file order');
    }
    totalFiles += s.files.length;
  }
  if (totalFiles > LIMITS.maxPhotosTotal) return bad('too many files');

  const now = new Date();
  const purgeAfter = new Date(now);
  purgeAfter.setDate(purgeAfter.getDate() + POLICY.retentionDays);

  const payload = {
    idempotency_key: idempotencyKey,
    exam_code: exam.code,
    grade: exam.grade,
    email: email.trim(),
    consent_at: now.toISOString(),
    purge_after: purgeAfter.toISOString().slice(0, 10),
    subjects: subjects.map((s) => ({
      subject_code: s.subjectCode,
      concerns: s.concerns ?? {},
      files: s.files.map((f) => ({
        storage_path: f.storagePath,
        order_index: f.orderIndex,
        bytes: f.bytes ?? null,
      })),
    })),
  };

  const db = supabaseAdmin();

  if (!db) {
    // 로컬 mock — 같은 멱등키면 같은 접수번호를 돌려준다
    const issued = mockIssued.get(idempotencyKey);
    if (issued) return NextResponse.json({ receiptNo: issued, dueDate: replyDueDate(now), mode: 'mock' });
    const day = now.toISOString().slice(0, 10);
    const seq = (mockSeq.get(day) ?? 0) + 1;
    mockSeq.set(day, seq);
    const receiptNo = formatReceiptNo(seq, now);
    mockIssued.set(idempotencyKey, receiptNo);
    return NextResponse.json({ receiptNo, dueDate: replyDueDate(now), mode: 'mock' });
  }

  const { data, error } = await db.rpc('create_submission', { payload });
  if (error || typeof data !== 'string') {
    console.error('[submit] create_submission failed', error);
    return NextResponse.json({ error: '접수 저장에 실패했어요' }, { status: 500 });
  }

  // 학생 화면은 여기서 끝난다. 무거운 일은 응답을 보낸 뒤에 이어서 한다 (PRD §7.3)
  const receiptNo = data;
  after(async () => {
    try {
      const result = await processSubmission(receiptNo);
      console.log('[submit] 후처리', JSON.stringify(result));
    } catch (err) {
      // 여기서 실패해도 접수는 이미 저장돼 있다. /api/worker/process 로 다시 돌리면 된다.
      console.error('[submit] 후처리 실패', receiptNo, err);
    }
  });

  return NextResponse.json({ receiptNo, dueDate: replyDueDate(now), mode: 'supabase' });
}
