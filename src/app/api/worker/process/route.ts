import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { workerAuthorized } from '@/lib/worker/auth';
import { processPending, processSubmission } from '@/lib/worker/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 밀린 접수를 다시 처리한다. 제출 직후 후처리가 실패했을 때의 복구 경로다.
 *
 *   POST /api/worker/process                     밀린 것부터 최대 5건
 *   POST /api/worker/process?receipt=F0902-013   특정 접수만
 *
 * WORKER_SECRET 이 있어야 한다. 예전에는 열쇠를 안 넣으면 통과시켰는데,
 * 그건 잠근 게 아니라 안 잠근 것이었다 — 이제 열쇠가 없으면 아무도 못 부른다.
 */
export async function POST(req: Request) {
  if (!workerAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const receipt = new URL(req.url).searchParams.get('receipt');

  if (receipt) {
    if (!/^[A-Za-z0-9-]{5,32}$/.test(receipt)) {
      return NextResponse.json({ error: 'invalid receipt' }, { status: 400 });
    }
    // 사람이 콕 집어 다시 돌리는 것이니, 자동 재시도 한도에 걸려 있어도 풀어준다
    await supabaseAdmin()
      ?.from('submissions')
      .update({ process_attempts: 0, status: 'failed' })
      .eq('receipt_no', receipt);
    return NextResponse.json(await processSubmission(receipt));
  }

  return NextResponse.json({ processed: await processPending() });
}
