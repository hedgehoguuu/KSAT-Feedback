import { NextResponse } from 'next/server';
import { RAW_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';
import { sendConfirmationMail } from '@/lib/worker/mail';
import { findExam } from '@/config/exams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 무엇이 왜 막혔는지 본다. 오류 원문이 나오므로 WORKER_SECRET 으로 잠근다.
 *
 *   GET /api/worker/status            실패 기록 + 최근 접수 상태
 *   GET /api/worker/status?probe=1    저장소에서 사진 한 장을 실제로 받아본다
 *   GET /api/worker/status?mail=1     운영자 주소로 시험 메일을 보내본다
 */
export async function GET(req: Request) {
  const secret = process.env.WORKER_SECRET;
  if (!secret || req.headers.get('x-worker-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: 'supabase 연결 없음' }, { status: 500 });

  const params = new URL(req.url).searchParams;
  const out: Record<string, unknown> = {};

  const failures = await db
    .from('sync_failures')
    .select('receipt_no, stage, subject_code, error, created_at, resolved')
    .order('created_at', { ascending: false })
    .limit(20);
  out.failures = failures.data ?? [];
  if (failures.error) out.failuresError = failures.error.message;

  type Row = {
    receipt_no: string;
    submission_subjects: {
      subject_code: string;
      pdf_path: string | null;
      notion_page_id: string | null;
      submission_files: { storage_path: string; bytes: number | null; order_index: number }[];
    }[];
  };

  const submissions = await db
    .from('submissions')
    .select(
      'receipt_no, exam_code, email, status, notion_ok, email_ok, process_attempts, created_at, ' +
        'submission_subjects(subject_code, pdf_path, notion_page_id, ' +
        'submission_files(storage_path, bytes, order_index))',
    )
    .order('created_at', { ascending: false })
    .limit(5);
  out.submissions = submissions.data ?? [];
  if (submissions.error) out.submissionsError = submissions.error.message;

  // ----------------------------------------- 저장소에서 실제로 받아보기
  if (params.get('probe') === '1') {
    // 중첩 관계 조회는 타입이 넓게 잡힌다. 실제 모양은 위 Row 와 같다.
    const rows = (submissions.data ?? []) as unknown as Row[];
    const first = rows
      .flatMap((s) => s.submission_subjects ?? [])
      .flatMap((s) => s.submission_files ?? [])[0];

    if (!first) {
      out.probe = { ok: false, error: '받아볼 파일이 없어요' };
    } else {
      const { data: blob, error } = await db.storage
        .from(RAW_BUCKET)
        .download(first.storage_path);
      out.probe = error
        ? { ok: false, path: first.storage_path, error: error.message, name: error.name }
        : { ok: true, path: first.storage_path, bytes: blob ? (await blob.arrayBuffer()).byteLength : 0 };
    }
  }

  // ------------------------------------------------- 메일 실제로 보내보기
  if (params.get('mail') === '1') {
    try {
      await sendConfirmationMail({
        receiptNo: 'TEST-000',
        to: process.env.GMAIL_USER!,
        dueDate: '2026-09-04',
        exam: findExam('G3_KICE')!,
        subjects: [{ code: 'math', photoCount: 3 }],
      });
      out.mail = { ok: true, to: process.env.GMAIL_USER };
    } catch (err) {
      out.mail = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: (err as { code?: string })?.code,
      };
    }
  }

  return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
}
