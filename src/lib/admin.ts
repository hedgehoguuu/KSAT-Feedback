import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * 관리자 잠금 (모집 페이지 PRD §05).
 *
 * 비밀번호 하나(ADMIN_PASSWORD)로 /admin 전체와 /setup 을 막는다. 계정 · 로그인 서비스를
 * 붙이지 않는 이유는 이 화면을 쓰는 사람이 팀 네 명뿐이기 때문이다.
 *
 * 쿠키에는 비밀번호를 넣지 않는다. `만료시각.서명` 만 넣고, 서명은 비밀번호를 열쇠로 한
 * HMAC 이다 — 쿠키를 훔쳐도 비밀번호는 나오지 않고, 비밀번호를 바꾸면 발급된 쿠키가 전부 죽는다.
 */
export const ADMIN_COOKIE = 'ut_admin';
const SESSION_DAYS = 7;

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function sign(expiresAt: number): string {
  const secret = process.env.ADMIN_PASSWORD ?? '';
  return createHmac('sha256', secret).update(`v1.${expiresAt}`).digest('hex');
}

/** 길이가 달라도 새는 정보가 없도록 해시를 먼저 뜨고 비교한다. */
function sameString(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function passwordMatches(input: string): boolean {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return false;
  return sameString(input, secret);
}

export function issueSession(): { value: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + maxAge;
  return { value: `${expiresAt}.${sign(expiresAt)}`, maxAge };
}

function validSession(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;

  const expiresAt = Number(token.slice(0, dot));
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;

  return sameString(token.slice(dot + 1), sign(expiresAt));
}

/** 지금 요청이 관리자인가. 비밀번호가 없는 배포에서는 항상 false 다 (열어 두지 않는다). */
export async function isAdmin(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const jar = await cookies();
  return validSession(jar.get(ADMIN_COOKIE)?.value);
}

/** 관리자 화면 맨 위에서 부른다. 아니면 로그인 화면으로 보낸다. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect('/admin/login');
}

/**
 * 쓰기(서버 함수)에서 부른다. 화면만 막고 서버 함수가 열려 있으면 잠근 것이 아니다 —
 * 서버 함수는 화면을 거치지 않고 POST 로 바로 불릴 수 있다.
 */
export async function assertAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new Error('관리자만 할 수 있어요');
}
