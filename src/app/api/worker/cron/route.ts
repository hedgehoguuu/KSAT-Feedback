import { NextResponse } from 'next/server';
import { processPending } from '@/lib/worker/process';
import { purgeExpiredFiles } from '@/lib/worker/purge';
import { cleanupOrphans } from '@/lib/worker/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 하루 한 번 도는 정리 작업 (vercel.json 의 crons).
 *
 *   1. 밀린 접수 처리 — 제출 직후 후처리가 시간 초과로 잘렸거나 실패한 건을 되살린다.
 *      이게 없으면 잘린 접수는 아무도 다시 돌려주지 않는다.
 *   2. 보관 기간이 지난 사진·PDF 삭제 (SEC-1)
 *   3. 주인 없는 사진 삭제 — ②단계에서 사진만 올리고 그만둔 경우다. 접수 기록이 없어
 *      2번이 못 잡는다. 무료 용량 1GB 를 이걸로 까먹으면 받을 수 있는 학생이 줄어든다.
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
  // 24시간이 지난 것만 지운다. 지금 사진을 올려두고 고민 사항을 쓰고 있는 학생이 있다.
  const orphans = await cleanupOrphans({ olderThanHours: 24 });
  return { processed, purge, orphans };
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await run());
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await run());
}
