import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * 비밀값 비교. `a === b` 는 앞에서부터 다른 글자가 나오는 순간 끝나서, 걸린 시간으로
 * 몇 글자까지 맞았는지가 새어 나간다. 길이가 달라도 새지 않도록 해시를 먼저 뜨고 비교한다.
 *
 * 관리자 비밀번호(lib/admin.ts)와 워커 열쇠(lib/worker/auth.ts)가 같이 쓴다.
 */
export function sameSecret(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
