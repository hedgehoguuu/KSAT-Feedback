import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';
import { getHealth } from '@/lib/health';
import { workerAuthorized } from '@/lib/worker/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * 설치 점검을 JSON 으로. /setup 과 같은 내용이라 같은 사람만 본다.
 *
 * 예전에는 누구나 열 수 있었다. 접수 · 신청 건수와 알림을 보내는 메일 주소가 그대로
 * 나갔다 — /setup 은 잠가 두고 같은 정보를 옆문으로 내보낸 셈이었다.
 *
 * 들어오는 길은 둘이다.
 *   관리자 로그인 쿠키   브라우저로 /admin 에 로그인한 뒤 이 주소를 연다 (매일 점검)
 *   WORKER_SECRET 헤더   스크립트 · 모니터링 (lib/worker/auth.ts)
 * 아니면 401 만 준다. 무엇이 준비 안 됐는지도 말하지 않는다.
 */
export async function GET(req: Request) {
  if (!workerAuthorized(req) && !(await isAdmin())) {
    return NextResponse.json(
      { error: '관리자만 볼 수 있어요. /admin/login 에서 로그인한 뒤 다시 열어주세요' },
      { status: 401, headers: NO_STORE },
    );
  }
  return NextResponse.json(await getHealth(), { headers: NO_STORE });
}
