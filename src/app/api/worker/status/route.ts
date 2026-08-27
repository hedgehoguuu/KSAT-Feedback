import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 무엇이 왜 막혔는지 본다. 오류 원문이 나오므로 WORKER_SECRET 으로 잠근다.
 *
 *   GET /api/worker/status   헤더: x-worker-secret
 */
export async function GET(req: Request) {
  const secret = process.env.WORKER_SECRET;
  if (!secret || req.headers.get('x-worker-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: 'supabase 연결 없음' }, { status: 500 });

  const [failures, submissions] = await Promise.all([
    db
      .from('sync_failures')
      .select('receipt_no, stage, subject_code, error, created_at, resolved')
      .order('created_at', { ascending: false })
      .limit(20),
    db
      .from('submissions')
      .select(
        'receipt_no, status, notion_ok, email_ok, process_attempts, created_at, ' +
          'submission_subjects(subject_code, pdf_path, notion_page_id, ' +
          'submission_files(storage_path, bytes))',
      )
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  return NextResponse.json(
    { failures: failures.data ?? [], submissions: submissions.data ?? [] },
    { headers: { 'cache-control': 'no-store' } },
  );
}
