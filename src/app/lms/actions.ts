'use server';

import { redirect } from 'next/navigation';
import { isRole, loginIdProblem, passwordProblem, ROLE_HOME } from '@/config/lms';
import { isAdmin } from '@/lib/admin';
import {
  assertRole,
  clearSessionCookie,
  currentUser,
  lmsConfigured,
  setSessionCookie,
  verifyPassword,
} from '@/lib/lms/auth';
import { changeOwnPassword, createUser, findForLogin, markLoggedIn, userCount } from '@/lib/lms/users';

/**
 * 모든 쓰기는 맨 앞에서 누구인지 확인한다. 서버 함수는 화면을 거치지 않고
 * POST 로 바로 불릴 수 있어서, 화면만 막는 건 잠근 것이 아니다.
 */

function field(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

export async function login(formData: FormData): Promise<void> {
  if (!lmsConfigured()) redirect('/lms/login?error=setup');

  const loginId = field(formData, 'login_id').toLowerCase();
  const password = String(formData.get('password') ?? '');

  const user = await findForLogin(loginId);

  /**
   * 아이디가 없을 때도 비밀번호를 확인하는 시늉을 한다 —
   * 없는 아이디만 빨리 튕기면 응답 시간만 보고도 어떤 아이디가 실재하는지 알 수 있다.
   */
  const ok = user
    ? verifyPassword(password, user.password_hash)
    : (verifyPassword(password, 's1.00.' + '0'.repeat(128)), false);

  // 무엇이 틀렸는지는 말하지 않는다. 아이디가 맞았다는 사실 자체가 정보다.
  if (!user || !ok) redirect('/lms/login?error=1');
  if (user.status !== 'active') redirect('/lms/login?error=suspended');
  if (!isRole(user.role)) redirect('/lms/login?error=1');

  await setSessionCookie(user.id);
  await markLoggedIn(user.id);

  // 관리자가 발급한 첫 비밀번호로 들어왔으면 바꾸고 나서야 다른 화면으로 간다.
  redirect(user.must_change_password ? '/lms/password' : ROLE_HOME[user.role]);
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect('/lms/login');
}

export async function changePassword(formData: FormData): Promise<void> {
  // 비밀번호를 바꾸는 동작 자체는 must_change_password 에 걸리면 안 되므로 assertRole 을 쓴다.
  const user = await assertRole('admin', 'tutor', 'student');

  const current = String(formData.get('current') ?? '');
  const next = String(formData.get('next') ?? '');
  const again = String(formData.get('again') ?? '');

  const found = await findForLogin(user.login_id);
  if (!found || !verifyPassword(current, found.password_hash)) redirect('/lms/password?error=current');

  const problem = passwordProblem(next);
  if (problem) redirect('/lms/password?error=weak');
  if (next !== again) redirect('/lms/password?error=mismatch');
  if (next === current) redirect('/lms/password?error=same');

  await changeOwnPassword(user.id, next);
  redirect(`${ROLE_HOME[user.role]}?changed=1`);
}

/**
 * 첫 관리자 계정을 만든다 (/lms/setup).
 *
 * 닭과 달걀 문제 — 계정을 만들려면 관리자로 로그인해야 하는데 관리자가 아직 없다.
 * 이미 있는 잠금(ADMIN_PASSWORD 로 여는 /admin)을 열쇠로 쓴다. 그리고 계정이
 * 한 개라도 있으면 이 문은 영영 닫힌다 — 열어 두면 아무나 관리자를 하나 더 만든다.
 */
export async function bootstrapAdmin(formData: FormData): Promise<void> {
  if (!(await isAdmin())) redirect('/admin/login');
  if ((await userCount()) > 0) redirect('/lms/login');

  const loginId = field(formData, 'login_id').toLowerCase();
  const password = String(formData.get('password') ?? '');
  const name = field(formData, 'name');

  if (loginIdProblem(loginId)) redirect('/lms/setup?error=id');
  if (passwordProblem(password)) redirect('/lms/setup?error=weak');
  if (!name) redirect('/lms/setup?error=name');

  const made = await createUser({ role: 'admin', login_id: loginId, password, name });
  if (made === 'DUPLICATE_ID') redirect('/lms/setup?error=dup');

  redirect('/lms/login?created=1');
}

/** 로그인 상태에 따라 제 집으로 보낸다. /lms 를 눌렀을 때 쓴다. */
export async function goHome(): Promise<never> {
  const user = await currentUser();
  if (!user) redirect('/lms/login');
  if (user.must_change_password) redirect('/lms/password');
  redirect(ROLE_HOME[user.role]);
}
