import { NextResponse } from 'next/server';
import { processPending } from '@/lib/worker/process';
import { purgeExpiredFiles } from '@/lib/worker/purge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 하루 한 번 도는 정리 작업 (vercel.json 의 crons).
 *
 *   1. 밀린 접수 처리 — 제출 직후 후처리가 시간 초과로 잘렸거나 실패한 건을 되살린다.
 *      이게 없으면 잘린 접수는 아무도 다시 돌려주지 않는다.
 *   2. 보관 기간이 지난 사진·PDF 삭제 (SEC-1)
 *
 * Vercel 크론은 헤더를 못 붙이므로 Authorization: Bearer 로 온다.
 * CRON_SECRET 또는 WORKER_SECRET 과 맞아야 실행된다.
 */
function authorized(req: Request): boolean {
  const worker = process.env.WORKER_SECRET;
  const cron = process.env.CRON_SECRET;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const header = req.headers.get('x-worker-secret');

  if (cron && bearer === cron) return true;
  if (worker && (header === worker || bearer === worker)) return true;
  return false;
}

async function run() {
  // 밀린 접수부터. 남은 시간을 다 쓰지 않도록 예산을 나눠 쓴다.
  const processed = await processPending(5, 30_000);
  const purge = await purgeExpiredFiles();
  return { processed, purge };
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await run());
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await run());
}
