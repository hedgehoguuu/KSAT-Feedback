import { NextResponse } from 'next/server';
import { deleteSubmission, purgeExpiredFiles } from '@/lib/worker/purge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 보관 기간이 지난 사진·PDF 를 지운다 (SEC-1). Vercel 크론이 하루 한 번 부른다.
 *
 *   POST /api/worker/purge                                보관 기간 지난 파일 정리
 *   POST /api/worker/purge?receipt=F0902-013&mode=delete  접수 1건 통째로 삭제 (되돌릴 수 없음)
 *
 * 크론은 헤더를 못 붙이므로 Authorization: Bearer 도 받는다.
 * CRON_SECRET 에 WORKER_SECRET 과 같은 값을 넣어두면 자동 정리가 돈다.
 */
function authorized(req: Request): boolean {
  const worker = process.env.WORKER_SECRET;
  const cron = process.env.CRON_SECRET;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const header = req.headers.get('x-worker-secret');

  if (worker && (header === worker || bearer === worker)) return true;
  if (cron && bearer === cron) return true;
  return false;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const receipt = params.get('receipt');

  if (receipt) {
    if (params.get('mode') !== 'delete') {
      return NextResponse.json({ error: '지우려면 mode=delete 를 함께 보내세요' }, { status: 400 });
    }
    if (!/^[A-Za-z0-9-]{5,32}$/.test(receipt)) {
      return NextResponse.json({ error: 'invalid receipt' }, { status: 400 });
    }
    return NextResponse.json(await deleteSubmission(receipt));
  }

  return NextResponse.json(await purgeExpiredFiles());
}

/** 크론은 GET 으로 부른다 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await purgeExpiredFiles());
}
