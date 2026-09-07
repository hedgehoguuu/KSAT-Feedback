import 'server-only';
import type { CourseStatus } from '@/config/lms';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { listStudents, type StudentRow } from './users';

function db() {
  const client = supabaseAdmin();
  if (!client) throw new Error('LMS_DB_MISSING');
  return client;
}

export type CourseRow = {
  id: string;
  name: string;
  class_id: string | null;
  tutor_id: string | null;
  status: CourseStatus;
  memo: string | null;
  created_at: string;
};

export type CourseCard = CourseRow & {
  tutorName: string;
  studentCount: number;
  examCount: number;
};

const COURSE_COLS = 'id, name, class_id, tutor_id, status, memo, created_at';

/**
 * 반 목록. tutorId 를 주면 그 튜터 반만 — 튜터 화면은 남의 반을 아예 안 읽는다.
 *
 * 학생 수·회차 수를 반마다 한 번씩 세면 반 열 개에 쿼리 스물한 개가 된다.
 * 통째로 한 번씩 읽어 와서 앱에서 센다. 이 규모(반 수십 개)에서는 이게 훨씬 싸다.
 */
export async function listCourses(tutorId?: string): Promise<CourseCard[]> {
  let q = db().from('lms_courses').select(COURSE_COLS).order('created_at', { ascending: false });
  if (tutorId) q = q.eq('tutor_id', tutorId);

  const { data } = await q;
  const courses = (data ?? []) as CourseRow[];
  if (courses.length === 0) return [];

  const ids = courses.map((c) => c.id);
  const [{ data: enrolls }, { data: exams }, { data: tutors }] = await Promise.all([
    db().from('lms_enrollments').select('course_id').in('course_id', ids),
    db().from('lms_exams').select('course_id').in('course_id', ids),
    db().from('lms_users').select('id, name').eq('role', 'tutor'),
  ]);

  const count = (rows: { course_id: string }[] | null, id: string) =>
    (rows ?? []).filter((r) => r.course_id === id).length;
  const tutorName = new Map(((tutors ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));

  return courses.map((c) => ({
    ...c,
    tutorName: (c.tutor_id && tutorName.get(c.tutor_id)) || '미배정',
    studentCount: count(enrolls as { course_id: string }[] | null, c.id),
    examCount: count(exams as { course_id: string }[] | null, c.id),
  }));
}

export async function getCourse(id: string): Promise<CourseRow | null> {
  const { data } = await db().from('lms_courses').select(COURSE_COLS).eq('id', id).maybeSingle();
  return (data as CourseRow) ?? null;
}

/**
 * 이 튜터가 이 반의 주인인가. 관리자는 늘 통과한다.
 * 튜터 화면의 모든 읽기·쓰기가 이 함수를 지나간다 — 주소창에 남의 반 id 를 넣어도 막힌다.
 */
export async function courseVisibleTo(
  courseId: string,
  user: { id: string; role: string },
): Promise<CourseRow | null> {
  const course = await getCourse(courseId);
  if (!course) return null;
  if (user.role === 'admin') return course;
  if (user.role === 'tutor' && course.tutor_id === user.id) return course;
  return null;
}

export async function saveCourse(input: {
  id?: string;
  name: string;
  tutor_id: string | null;
  class_id: string | null;
  status: CourseStatus;
  memo: string | null;
}): Promise<string> {
  const row = {
    name: input.name.trim(),
    tutor_id: input.tutor_id,
    class_id: input.class_id,
    status: input.status,
    memo: input.memo,
  };

  if (input.id) {
    await db().from('lms_courses').update(row).eq('id', input.id);
    return input.id;
  }

  const { data, error } = await db().from('lms_courses').insert(row).select('id').single();
  if (error || !data) throw error ?? new Error('LMS_CREATE_COURSE_FAILED');
  return data.id;
}

export async function deleteCourse(id: string): Promise<void> {
  // 반을 지우면 그 반의 회차·문항표·응시가 함께 사라진다(cascade). 학생 계정은 남는다.
  await db().from('lms_courses').delete().eq('id', id);
}

/* ───────────────────────────────────────────────────────────── 수강 */

export async function listEnrolled(courseId: string): Promise<StudentRow[]> {
  const { data } = await db().from('lms_enrollments').select('student_id').eq('course_id', courseId);
  const ids = new Set(((data ?? []) as { student_id: string }[]).map((r) => r.student_id));
  if (ids.size === 0) return [];

  // 학생 수가 반당 수십 명이라 통째로 읽고 거른다. 이름순 정렬을 한곳에서만 하려는 뜻도 있다.
  return (await listStudents()).filter((s) => ids.has(s.id));
}

export async function enroll(courseId: string, studentId: string): Promise<void> {
  // 이미 들어 있으면 아무 일도 안 일어난다 (기본키 충돌 무시).
  await db()
    .from('lms_enrollments')
    .upsert({ course_id: courseId, student_id: studentId }, { onConflict: 'course_id,student_id' });
}

export async function unenroll(courseId: string, studentId: string): Promise<void> {
  await db().from('lms_enrollments').delete().eq('course_id', courseId).eq('student_id', studentId);
}

/** 이 학생이 듣는 반. 학생 화면이 자기 회차를 찾을 때 쓴다. */
export async function coursesOfStudent(studentId: string): Promise<CourseRow[]> {
  const { data } = await db().from('lms_enrollments').select('course_id').eq('student_id', studentId);
  const ids = ((data ?? []) as { course_id: string }[]).map((r) => r.course_id);
  if (ids.length === 0) return [];

  const { data: courses } = await db().from('lms_courses').select(COURSE_COLS).in('id', ids).order('created_at', { ascending: false });
  return (courses ?? []) as CourseRow[];
}

/**
 * 이 학생이 이 사람의 반에 있는가. 관리자는 늘 통과한다.
 *
 * 튜터가 학생 비밀번호를 재발급할 수 있게 하려면 그 학생이 정말 자기 반 학생인지를
 * 먼저 확인해야 한다. 이게 없으면 튜터가 학생 id 만 알면 남의 반 학생 비밀번호를 바꿀 수 있다.
 */
export async function studentVisibleTo(
  studentId: string,
  user: { id: string; role: string },
): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (user.role !== 'tutor') return false;

  const courses = await coursesOfStudent(studentId);
  return courses.some((c) => c.tutor_id === user.id);
}
