import 'server-only';
import { isElective, isRole, type Elective, type Role, type UserStatus } from '@/config/lms';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hashPassword } from './auth';

/** DB 가 없으면 LMS 는 아무것도 못 한다. mock 으로 흉내내지 않고 바로 말한다. */
function db() {
  const client = supabaseAdmin();
  if (!client) throw new Error('LMS_DB_MISSING');
  return client;
}

export type UserRow = {
  id: string;
  role: Role;
  login_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: UserStatus;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
};

export type StudentProfile = {
  user_id: string;
  grade: number | null;
  school: string | null;
  elective: Elective | null;
  parent_phone: string | null;
  receipt_no: string | null;
  memo: string | null;
};

export type StudentRow = UserRow & { profile: StudentProfile | null };

const USER_COLS = 'id, role, login_id, name, phone, email, status, must_change_password, last_login_at, created_at';
const PROFILE_COLS = 'user_id, grade, school, elective, parent_phone, receipt_no, memo';

/** 계정이 한 개도 없으면 첫 관리자를 만들 수 있는 상태다 (/lms/setup). */
export async function userCount(): Promise<number> {
  const { count } = await db().from('lms_users').select('id', { count: 'exact', head: true });
  return count ?? 0;
}

export async function listUsers(role?: Role): Promise<UserRow[]> {
  let q = db().from('lms_users').select(USER_COLS).order('name');
  if (role) q = q.eq('role', role);
  const { data } = await q;
  return (data ?? []) as UserRow[];
}

export async function getUser(id: string): Promise<UserRow | null> {
  const { data } = await db().from('lms_users').select(USER_COLS).eq('id', id).maybeSingle();
  return (data as UserRow) ?? null;
}

/** 로그인용. 여기서만 password_hash 를 꺼낸다 — 다른 조회에 섞이면 언젠가 화면으로 샌다. */
export async function findForLogin(
  loginId: string,
): Promise<(UserRow & { password_hash: string }) | null> {
  const { data } = await db()
    .from('lms_users')
    .select(`${USER_COLS}, password_hash`)
    .eq('login_id', loginId.trim().toLowerCase())
    .maybeSingle();
  return (data as UserRow & { password_hash: string }) ?? null;
}

export async function markLoggedIn(id: string): Promise<void> {
  await db().from('lms_users').update({ last_login_at: new Date().toISOString() }).eq('id', id);
}

export async function getStudent(userId: string): Promise<StudentRow | null> {
  const user = await getUser(userId);
  if (!user || user.role !== 'student') return null;

  const { data } = await db().from('lms_students').select(PROFILE_COLS).eq('user_id', userId).maybeSingle();
  return { ...user, profile: (data as StudentProfile) ?? null };
}

export async function listStudents(): Promise<StudentRow[]> {
  const users = await listUsers('student');
  if (users.length === 0) return [];

  const { data } = await db()
    .from('lms_students')
    .select(PROFILE_COLS)
    .in('user_id', users.map((u) => u.id));

  const byId = new Map(((data ?? []) as StudentProfile[]).map((p) => [p.user_id, p]));
  return users.map((u) => ({ ...u, profile: byId.get(u.id) ?? null }));
}

export type NewUser = {
  role: Role;
  login_id: string;
  password: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  /** 학생일 때만 쓰인다. */
  student?: Partial<Omit<StudentProfile, 'user_id'>>;
};

/**
 * 계정을 만든다. 아이디가 이미 있으면 'DUPLICATE_ID' 를 돌려준다 —
 * 예외를 던지면 화면이 "잠시 문제가 생겼어요" 로 떨어져서 무엇이 잘못됐는지 안 보인다.
 */
export async function createUser(input: NewUser): Promise<{ id: string } | 'DUPLICATE_ID'> {
  const login_id = input.login_id.trim().toLowerCase();

  const { data, error } = await db()
    .from('lms_users')
    .insert({
      role: input.role,
      login_id,
      password_hash: hashPassword(input.password),
      name: input.name.trim(),
      phone: input.phone || null,
      email: input.email || null,
      // 관리자가 만들어 준 비밀번호는 본인이 한 번 바꾸고 나서야 쓸 수 있다.
      must_change_password: true,
    })
    .select('id')
    .single();

  // 23505 = unique 위반. 아이디 중복 말고는 이 표에 unique 가 없다.
  if (error?.code === '23505') return 'DUPLICATE_ID';
  if (error || !data) throw error ?? new Error('LMS_CREATE_USER_FAILED');

  if (input.role === 'student') await upsertStudentProfile(data.id, input.student ?? {});
  return { id: data.id };
}

export async function upsertStudentProfile(
  userId: string,
  profile: Partial<Omit<StudentProfile, 'user_id'>>,
): Promise<void> {
  await db()
    .from('lms_students')
    .upsert(
      {
        user_id: userId,
        grade: profile.grade ?? null,
        school: profile.school ?? null,
        elective: profile.elective && isElective(profile.elective) ? profile.elective : null,
        parent_phone: profile.parent_phone ?? null,
        receipt_no: profile.receipt_no ?? null,
        memo: profile.memo ?? null,
      },
      { onConflict: 'user_id' },
    );
}

export async function updateUser(
  id: string,
  patch: { name?: string; phone?: string | null; email?: string | null; status?: UserStatus; role?: Role },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.phone !== undefined) row.phone = patch.phone || null;
  if (patch.email !== undefined) row.email = patch.email || null;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.role !== undefined && isRole(patch.role)) row.role = patch.role;
  if (Object.keys(row).length === 0) return;

  await db().from('lms_users').update(row).eq('id', id);
}

/**
 * 관리자가 비밀번호를 새로 발급한다. 발급된 비밀번호는 본인이 바꿔야 하므로
 * must_change_password 를 다시 켠다.
 */
export async function resetPassword(id: string, password: string): Promise<void> {
  await db()
    .from('lms_users')
    .update({ password_hash: hashPassword(password), must_change_password: true })
    .eq('id', id);
}

/** 본인이 직접 바꾼다. 이때는 강제 변경을 끈다. */
export async function changeOwnPassword(id: string, password: string): Promise<void> {
  await db()
    .from('lms_users')
    .update({ password_hash: hashPassword(password), must_change_password: false })
    .eq('id', id);
}

/**
 * 계정을 지운다. 학생을 지우면 그 학생의 응시·정오·코멘트가 함께 사라진다(cascade).
 * 튜터는 반이 걸려 있으면 DB 가 막는다(on delete restrict) — 반을 먼저 옮겨야 한다.
 */
export async function deleteUser(id: string): Promise<'OK' | 'IN_USE'> {
  const { error } = await db().from('lms_users').delete().eq('id', id);
  if (error?.code === '23503') return 'IN_USE';
  if (error) throw error;
  return 'OK';
}
