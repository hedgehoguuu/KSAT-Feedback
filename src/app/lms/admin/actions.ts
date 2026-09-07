'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  isCourseStatus,
  isElective,
  isRole,
  loginIdProblem,
  passwordProblem,
  type Elective,
} from '@/config/lms';
import { assertRole } from '@/lib/lms/auth';
import { deleteCourse, saveCourse } from '@/lib/lms/courses';
import {
  createUser,
  deleteUser,
  resetPassword,
  updateUser,
  upsertStudentProfile,
} from '@/lib/lms/users';

/** 관리자만 지나간다. 화면을 막는 것과 별개로 여기서 한 번 더 확인한다. */
function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function optional(form: FormData, key: string): string | null {
  const v = text(form, key);
  return v.length > 0 ? v : null;
}

function electiveOf(form: FormData): Elective | null {
  const v = text(form, 'elective');
  return isElective(v) ? v : null;
}

function gradeOf(form: FormData): number | null {
  const v = Number(text(form, 'grade'));
  return Number.isInteger(v) && v >= 1 && v <= 3 ? v : null;
}

/* ──────────────────────────────────────────────────────────── 계정 */

export async function createAccount(formData: FormData): Promise<void> {
  await assertRole('admin');

  const role = text(formData, 'role');
  const login_id = text(formData, 'login_id').toLowerCase();
  const password = String(formData.get('password') ?? '');
  const name = text(formData, 'name');

  if (!isRole(role)) redirect('/lms/admin?error=role');
  if (loginIdProblem(login_id)) redirect('/lms/admin?error=id');
  if (passwordProblem(password)) redirect('/lms/admin?error=weak');
  if (!name) redirect('/lms/admin?error=name');

  const made = await createUser({
    role,
    login_id,
    password,
    name,
    phone: optional(formData, 'phone'),
    email: optional(formData, 'email'),
    student:
      role === 'student'
        ? {
            grade: gradeOf(formData),
            school: optional(formData, 'school'),
            elective: electiveOf(formData),
            parent_phone: optional(formData, 'parent_phone'),
            receipt_no: optional(formData, 'receipt_no'),
          }
        : undefined,
  });

  if (made === 'DUPLICATE_ID') redirect('/lms/admin?error=dup');

  revalidatePath('/lms/admin');
  redirect(`/lms/admin?made=${encodeURIComponent(login_id)}`);
}

export async function updateAccount(formData: FormData): Promise<void> {
  await assertRole('admin');

  const id = text(formData, 'id');
  const role = text(formData, 'role');
  if (!id) redirect('/lms/admin');

  await updateUser(id, {
    name: text(formData, 'name'),
    phone: optional(formData, 'phone'),
    email: optional(formData, 'email'),
  });

  if (role === 'student') {
    await upsertStudentProfile(id, {
      grade: gradeOf(formData),
      school: optional(formData, 'school'),
      elective: electiveOf(formData),
      parent_phone: optional(formData, 'parent_phone'),
      receipt_no: optional(formData, 'receipt_no'),
      memo: optional(formData, 'memo'),
    });
  }

  revalidatePath(`/lms/admin/users/${id}`);
  redirect(`/lms/admin/users/${id}?saved=1`);
}

export async function resetAccountPassword(formData: FormData): Promise<void> {
  await assertRole('admin');

  const id = text(formData, 'id');
  const password = String(formData.get('password') ?? '');
  if (!id) redirect('/lms/admin');
  if (passwordProblem(password)) redirect(`/lms/admin/users/${id}?error=weak`);

  await resetPassword(id, password);
  redirect(`/lms/admin/users/${id}?reset=1`);
}

export async function setAccountStatus(formData: FormData): Promise<void> {
  const me = await assertRole('admin');

  const id = text(formData, 'id');
  const status = text(formData, 'status') === 'suspended' ? 'suspended' : 'active';

  // 자기 자신을 정지시키면 아무도 관리자 화면에 못 들어간다.
  if (id === me.id) redirect('/lms/admin/users/' + id + '?error=self');

  await updateUser(id, { status });
  revalidatePath(`/lms/admin/users/${id}`);
  redirect(`/lms/admin/users/${id}`);
}

export async function deleteAccount(formData: FormData): Promise<void> {
  const me = await assertRole('admin');

  const id = text(formData, 'id');
  if (id === me.id) redirect(`/lms/admin/users/${id}?error=self`);

  const result = await deleteUser(id);
  if (result === 'IN_USE') redirect(`/lms/admin/users/${id}?error=inuse`);

  revalidatePath('/lms/admin');
  redirect('/lms/admin');
}

/* ────────────────────────────────────────────────────────────── 반 */

export async function saveCourseAction(formData: FormData): Promise<void> {
  await assertRole('admin');

  const name = text(formData, 'name');
  const status = text(formData, 'status');
  if (!name) redirect('/lms/admin/courses?error=name');

  await saveCourse({
    id: optional(formData, 'id') ?? undefined,
    name,
    tutor_id: optional(formData, 'tutor_id'),
    class_id: null,
    status: isCourseStatus(status) ? status : 'active',
    memo: optional(formData, 'memo'),
  });

  revalidatePath('/lms/admin/courses');
  redirect('/lms/admin/courses?saved=1');
}

export async function deleteCourseAction(formData: FormData): Promise<void> {
  await assertRole('admin');

  const id = text(formData, 'id');
  if (!id) redirect('/lms/admin/courses');

  await deleteCourse(id);
  revalidatePath('/lms/admin/courses');
  redirect('/lms/admin/courses');
}
