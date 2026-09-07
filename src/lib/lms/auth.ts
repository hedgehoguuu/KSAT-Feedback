import 'server-only';
import { createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LMS, ROLE_HOME, isRole, type Role, type UserStatus } from '@/config/lms';
import { sameSecret } from '@/lib/secret';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * LMS 인증.
 *
 * 기존 관리자 잠금(lib/admin.ts)은 비밀번호 하나로 문 전체를 막는 방식이다. 쓰는 사람이
 * 팀 네 명뿐이라 그걸로 충분했다. 여기는 다르다 — 학생이 자기 것만 봐야 하고, 튜터가
 * 자기 반만 봐야 하므로 '누구인가' 가 있어야 한다.
 *
 * 그렇다고 Supabase Auth 를 붙이지는 않았다. 이 프로젝트는 브라우저가 Supabase 에 직접
 * 붙지 않는다(anon 키가 아예 없다). 인증만을 위해 그 원칙을 깨면 RLS 정책을 새로 짜야 하고,
 * 서버만 DB 를 만지는 지금 구조가 통째로 흔들린다. 그래서 계정표를 직접 두고,
 * 쿠키는 이미 쓰던 HMAC 서명 방식을 그대로 확장했다.
 *
 * 쿠키에 담기는 것: `v1.사용자ID.만료시각.서명`
 * 역할(role)은 담지 않는다. 담으면 관리자가 계정을 정지시키거나 역할을 낮춰도
 * 이미 나간 쿠키가 만료될 때까지 살아 있다. 매 요청마다 DB 에서 다시 읽는다.
 */

export const LMS_COOKIE = 'ut_lms';

/**
 * 서명 열쇠. 전용 값(LMS_SESSION_SECRET)이 있으면 그걸 쓰고, 없으면 이미 있는
 * 관리자 비밀번호를 쓴다 — 새 환경변수 없이도 켜지게 하려는 것이다.
 * 둘 다 없으면 LMS 는 열리지 않는다 (서명 없는 쿠키는 아무나 위조한다).
 */
function sessionSecret(): string | null {
  return process.env.LMS_SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

/** 로그인을 받을 수 있는 상태인가. 열쇠와 DB 가 둘 다 있어야 한다. */
export function lmsConfigured(): boolean {
  return Boolean(sessionSecret()) && supabaseAdmin() !== null;
}

export function lmsSetupProblem(): string | null {
  if (!supabaseAdmin()) return 'SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 가 필요해요';
  if (!sessionSecret()) return 'LMS_SESSION_SECRET (또는 ADMIN_PASSWORD) 가 필요해요';
  return null;
}

// 비밀번호 해시는 password.ts 에 있다. 여기(쿠키·세션)와 하는 일이 달라서 떼어 뒀다.

/* ──────────────────────────────────────────────────────────── 세션 */

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret() ?? '').update(payload).digest('hex');
}

export function issueSession(userId: string): { value: string; maxAge: number } {
  const maxAge = LMS.sessionDays * 24 * 60 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + maxAge;
  const payload = `v1.${userId}.${expiresAt}`;
  return { value: `${payload}.${sign(payload)}`, maxAge };
}

/** 쿠키에서 사용자 ID 만 꺼낸다. 서명과 만료가 맞아야 한다. */
function readSession(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;

  const [ver, userId, expiresRaw, sig] = parts;
  if (ver !== 'v1' || !userId) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return null;
  if (!sameSecret(sig, sign(`v1.${userId}.${expiresAt}`))) return null;

  return userId;
}

export async function setSessionCookie(userId: string): Promise<void> {
  const session = issueSession(userId);
  const jar = await cookies();
  jar.set(LMS_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: session.maxAge,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(LMS_COOKIE);
}

/* ────────────────────────────────────────────────────────── 현재 사용자 */

export type SessionUser = {
  id: string;
  role: Role;
  login_id: string;
  name: string;
  status: UserStatus;
  must_change_password: boolean;
};

/**
 * 지금 요청이 누구인가. 로그인 안 했으면 null.
 * 쿠키만 믿지 않고 매번 DB 를 본다 — 정지된 계정이 쿠키 만료까지 살아 있으면 안 된다.
 */
export async function currentUser(): Promise<SessionUser | null> {
  if (!lmsConfigured()) return null;

  const jar = await cookies();
  const userId = readSession(jar.get(LMS_COOKIE)?.value);
  if (!userId) return null;

  const db = supabaseAdmin();
  if (!db) return null;

  const { data, error } = await db
    .from('lms_users')
    .select('id, role, login_id, name, status, must_change_password')
    .eq('id', userId)
    .maybeSingle();

  /**
   * 여기만 실패를 던지지 않고 '로그인 안 한 사람' 으로 친다.
   *
   * 다른 곳은 못 읽으면 던진다 — 조용히 틀린 화면보다 시끄러운 오류가 낫기 때문이다.
   * 그런데 '이 사람이 누구인가' 를 못 읽었을 때 통과시키면 그건 잠금이 풀린 것이다.
   * 못 읽었으면 아무도 아닌 것으로 두는 쪽이 맞다 — 잠긴 채로 실패해야 한다.
   *
   * 대신 DB 가 잠깐 흔들리면 로그인이 풀린 것처럼 보인다. 쿠키는 그대로라 다시 들어가면 된다.
   */
  if (error || !data || data.status !== 'active' || !isRole(data.role)) return null;
  return data as SessionUser;
}

/**
 * 화면 맨 위에서 부른다. 로그인 안 했거나 역할이 다르면 되돌려 보낸다.
 *
 * 역할이 다를 때 로그인 화면이 아니라 '자기 집' 으로 보낸다 — 이미 로그인한 학생을
 * 로그인 화면으로 보내면 아무 일도 안 일어나는 것처럼 보여서 무한히 헤맨다.
 */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/lms/login');
  if (!roles.includes(user.role)) redirect(ROLE_HOME[user.role]);

  // 처음 받은 비밀번호를 아직 안 바꿨으면 그 화면에 붙잡아 둔다.
  if (user.must_change_password) redirect('/lms/password');
  return user;
}

/**
 * 쓰기(서버 함수) 맨 앞에서 부른다. 화면만 막는 건 잠근 게 아니다 —
 * 서버 함수는 화면을 거치지 않고 POST 로 바로 불릴 수 있다.
 *
 * requireRole 과 달리 비밀번호 변경 강제는 걸지 않는다. 비밀번호를 바꾸는 그 동작
 * 자체가 여기를 지나가기 때문이다.
 */
export async function assertRole(...roles: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/lms/login?expired=1');
  if (!roles.includes(user.role)) redirect(ROLE_HOME[user.role]);
  return user;
}
