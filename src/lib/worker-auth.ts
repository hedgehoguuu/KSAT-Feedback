import 'server-only';
import { sameSecret } from '@/lib/secret';

/**
 * 운영용 주소(/api/worker/*)의 자물쇠.
 *
 * 다섯 라우트가 저마다 조금씩 다르게 적고 있던 것을 한 곳으로 모았다. 그중 하나는
 * 열쇠가 없으면 통과시켜서 — WORKER_SECRET 을 안 넣은 배포에서 누구나 재처리를
 * 부를 수 있었다. 여기서는 열쇠가 없으면 무조건 막는다. 잠금은 기본값이어야 한다.
 *
 * 받는 방법 두 가지:
 *   x-worker-secret: <값>          손으로 부를 때
 *   Authorization: Bearer <값>     Vercel 크론은 헤더를 못 붙여서 이쪽으로 온다
 */
function bearer(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function matches(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  return sameSecret(req.headers.get('x-worker-secret'), secret) || sameSecret(bearer(req), secret);
}

/** 운영용 주소. WORKER_SECRET 이 있어야 하고, 맞아야 한다. */
export function workerAuthorized(req: Request): boolean {
  return matches(req, process.env.WORKER_SECRET);
}

/**
 * 크론이 부르는 주소. WORKER_SECRET 과 CRON_SECRET 둘 중 하나면 된다 —
 * Vercel 크론은 CRON_SECRET 을 Bearer 로 붙여 보낸다.
 */
export function cronAuthorized(req: Request): boolean {
  return workerAuthorized(req) || matches(req, process.env.CRON_SECRET);
}
