import { NextResponse } from 'next/server';
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
 * WORKER_SECRET 을 넣어두면 그 값을 헤더로 보내야만 실행된다.
 * 비워두면 누구나 호출할 수 있으니, 접수를 열기 전에 반드시 넣을 것.
 */
export async function POST(req: Request) {
  const secret = process.env.WORKER_SECRET;
  if (secret && req.headers.get('x-worker-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const receipt = new URL(req.url).searchParams.get('receipt');

  if (receipt) {
    if (!/^[A-Za-z0-9-]{5,32}$/.test(receipt)) {
      return NextResponse.json({ error: 'invalid receipt' }, { status: 400 });
    }
    return NextResponse.json(await processSubmission(receipt));
  }

  return NextResponse.json({ processed: await processPending() });
}
