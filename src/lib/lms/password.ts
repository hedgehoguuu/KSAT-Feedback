import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * 비밀번호 해시.
 *
 * 세션·쿠키(auth.ts)와 떼어 뒀다. 둘은 하는 일이 다르고, 무엇보다 여기는 Next 를 하나도
 * 안 쓴다 — 그래서 브라우저도 서버도 아닌 곳(시험)에서 그대로 불러 확인할 수 있다.
 */

/**
 * scrypt. bcrypt·argon2 를 쓰려면 패키지를 더해야 하는데, scrypt 는 node 에 이미 있고
 * 같은 계열의 메모리-하드 함수다. 의존성 없이 쓸 수 있는 것 중에서는 이게 맞다.
 *
 * 저장 형태: `s1.{salt}.{hash}` — 나중에 계수를 올릴 때 앞의 s1 로 구분한다.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keyLen, SCRYPT);
  return `s1.${salt.toString('hex')}.${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [ver, saltHex, keyHex] = stored.split('.');
  if (ver !== 's1' || !saltHex || !keyHex) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(keyHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT.keyLen) return false;

  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT.keyLen, SCRYPT);
  return timingSafeEqual(actual, expected);
}

