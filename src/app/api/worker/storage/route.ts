import { NextResponse } from 'next/server';
import { cleanupOrphans, inventory, wipeStorage } from '@/lib/worker/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 저장소에 무엇이 쌓여 있는지 보고, 필요 없는 것을 지운다.
 *
 *   GET  /api/worker/storage                       지금 무엇이 얼마나 있는지
 *   POST /api/worker/storage?mode=orphans          접수로 안 이어진 파일 삭제 (24시간 지난 것)
 *   POST /api/worker/storage?mode=orphans&hours=0  방금 올라온 것까지 전부 (접수 열기 전에만)
 *   POST /api/worker/storage?mode=orphans&dry=1    지우지 않고 몇 개인지만 세기
 *   POST /api/worker/storage?mode=wipe&confirm=WIPE-ALL   버킷 통째로 비우기 (되돌릴 수 없음)
 *
 * WORKER_SECRET 헤더가 있어야 한다.
 */
function authorized(req: Request): boolean {
  const worker = process.env.WORKER_SECRET;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return Boolean(worker) && (req.headers.get('x-worker-secret') === worker || bearer === worker);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await inventory(), { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const mode = params.get('mode');

  if (mode === 'wipe') {
    // 접수에 걸려 있는 사진까지 전부 지운다. 실수로 부르면 안 되므로 확인 문구를 받는다.
    if (params.get('confirm') !== 'WIPE-ALL') {
      return NextResponse.json(
        { error: '버킷을 비우려면 confirm=WIPE-ALL 을 함께 보내세요' },
        { status: 400 },
      );
    }
    return NextResponse.json(await wipeStorage());
  }

  if (mode === 'orphans') {
    const raw = params.get('hours');
    const hours = raw === null ? 24 : Number(raw);
    if (!Number.isFinite(hours) || hours < 0) {
      return NextResponse.json({ error: 'hours 는 0 이상의 숫자여야 해요' }, { status: 400 });
    }
    return NextResponse.json(
      await cleanupOrphans({ olderThanHours: hours, dryRun: params.get('dry') === '1' }),
    );
  }

  return NextResponse.json({ error: 'mode=orphans 또는 mode=wipe 가 필요해요' }, { status: 400 });
}
