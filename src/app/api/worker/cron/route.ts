import { NextResponse } from 'next/server';
import { purgeExpiredApplications } from '@/lib/class/classes';
import { processPending } from '@/lib/intake/worker/process';
import { purgeExpiredFiles } from '@/lib/intake/worker/purge';
import { cleanupOrphans } from '@/lib/intake/worker/storage';
import { retryPhotoReads } from '@/lib/lms/photo-read';
import { cronAuthorized } from '@/lib/worker-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 5번(사진 읽기 되살리기)이 한 판에 1–2분씩 걸린다.
export const maxDuration = 300;

/**
 * 하루 한 번 도는 정리 작업 (vercel.json 의 crons).
 *
 *   1. 밀린 접수 처리 — 제출 직후 후처리가 시간 초과로 잘렸거나 실패한 건을 되살린다.
 *      이게 없으면 잘린 접수는 아무도 다시 돌려주지 않는다.
 *   2. 보관 기간이 지난 사진·PDF 삭제 (SEC-1)
 *   3. 보관 기간(90일)이 지난 수업 신청 삭제 — 사진과 달리 행 자체를 지운다
 *   4. 주인 없는 사진 삭제 — ②단계에서 사진만 올리고 그만둔 경우다. 접수 기록이 없어
 *      2번이 못 잡는다. 무료 용량 1GB 를 이걸로 까먹으면 받을 수 있는 학생이 줄어든다.
 *   5. 성적 관리의 사진 읽기(자동 채점) 되살리기 — 서버가 중간에 끊겨 '읽는 중' 에 멈췄거나,
 *      요청이 몰려 실패한 읽기를 한 번 더 돌린다. 아침에 튜터가 열면 채점이 채워져 있다.
 *
 * 자물쇠는 lib/worker-auth.ts 에 있다. CRON_SECRET 또는 WORKER_SECRET 과 맞아야 실행된다.
 */
async function run() {
  // 이 함수 전체의 마감. maxDuration(300초)보다 먼저 끝내야 마지막 결과까지 적힌다.
  const deadline = Date.now() + 270_000;
  // 밀린 접수부터. 남은 시간을 다 쓰지 않도록 예산을 나눠 쓴다.
  const processed = await processPending(5, 30_000);
  const purge = await purgeExpiredFiles();
  // 24시간이 지난 것만 지운다. 지금 사진을 올려두고 고민 사항을 쓰고 있는 학생이 있다.
  const orphans = await cleanupOrphans({ olderThanHours: 24 });
  // 수업 신청은 사진이 아니라 개인정보라 행 자체를 지운다 (모집 페이지 PRD §06)
  const applications = await purgeExpiredApplications();
  // 남은 시간 안에서만. 한 판이 끝나기 전에 서버 함수가 끊기면 또 멈춘 채로 남는다.
  const photoReads = await retryPhotoReads({ deadline, limit: 5 }).catch((error) => {
    console.error('[cron] 사진 읽기 되살리기 실패', error);
    return { found: 0, done: 0, failed: 0 };
  });
  return { processed, purge, orphans, applications, photoReads };
}

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await run());
}

export async function POST(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await run());
}
