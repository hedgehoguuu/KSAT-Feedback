import 'server-only';
import type { CourseStatus } from '@/config/lms';
import { db, inChunks, must, one, rows } from './db';
import { getUser, listStudents, type StudentRow } from './users';

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

  const courses = (await rows(q)) as CourseRow[];
  if (courses.length === 0) return [];

  const ids = courses.map((c) => c.id);
  const [enrolls, exams, tutors] = await Promise.all([
    inChunks<{ course_id: string }>(ids, (b) =>
      db().from('lms_enrollments').select('course_id').in('course_id', b).order('course_id').order('student_id')),
    inChunks<{ course_id: string }>(ids, (b) =>
      db().from('lms_exams').select('course_id').in('course_id', b).order('id')),
    rows<{ id: string; name: string }>(db().from('lms_users').select('id, name').eq('role', 'tutor')),
  ]);

  const count = (list: { course_id: string }[], id: string) => list.filter((r) => r.course_id === id).length;
  const tutorName = new Map(tutors.map((t) => [t.id, t.name]));

  return courses.map((c) => ({
    ...c,
    tutorName: (c.tutor_id && tutorName.get(c.tutor_id)) || '미배정',
    studentCount: count(enrolls, c.id),
    examCount: count(exams, c.id),
  }));
}

export async function getCourse(id: string): Promise<CourseRow | null> {
  return await one<CourseRow>(db().from('lms_courses').select(COURSE_COLS).eq('id', id).maybeSingle());
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
    await must(db().from('lms_courses').update(row).eq('id', input.id));
    return input.id;
  }

  const { data, error } = await db().from('lms_courses').insert(row).select('id').single();
  if (error || !data) throw error ?? new Error('LMS_CREATE_COURSE_FAILED');
  return data.id;
}

export async function deleteCourse(id: string): Promise<void> {
  // 반을 지우면 그 반의 회차·문항표·응시가 함께 사라진다(cascade). 학생 계정은 남는다.
  await must(db().from('lms_courses').delete().eq('id', id));
}

/* ───────────────────────────────────────────────────────────── 수강 */

export async function listEnrolled(courseId: string): Promise<StudentRow[]> {
  const enrolled = await rows<{ student_id: string }>(
    db().from('lms_enrollments').select('student_id').eq('course_id', courseId),
  );
  const ids = new Set(enrolled.map((r) => r.student_id));
  if (ids.size === 0) return [];

  // 학생 수가 반당 수십 명이라 통째로 읽고 거른다. 이름순 정렬을 한곳에서만 하려는 뜻도 있다.
  return (await listStudents()).filter((s) => ids.has(s.id));
}

/**
 * 수강 등록. 학생 계정만 넣는다.
 *
 * 폼은 학생 목록만 보여주지만 id 는 손으로 바꿔 보낼 수 있다. 여기서 안 막으면 튜터가
 * 관리자 id 를 자기 반에 넣고, '자기 반 학생 비밀번호 재발급' 으로 관리자 비밀번호를 바꾼다.
 */
export async function enroll(courseId: string, studentId: string): Promise<'OK' | 'NOT_STUDENT'> {
  const target = await getUser(studentId);
  if (!target || target.role !== 'student') return 'NOT_STUDENT';

  // 이미 들어 있으면 아무 일도 안 일어난다 (기본키 충돌 무시).
  await must(
    db()
      .from('lms_enrollments')
      .upsert({ course_id: courseId, student_id: studentId }, { onConflict: 'course_id,student_id' }),
  );
  return 'OK';
}

export async function unenroll(courseId: string, studentId: string): Promise<void> {
  await must(db().from('lms_enrollments').delete().eq('course_id', courseId).eq('student_id', studentId));
}

/** 이 학생이 듣는 반. 학생 화면이 자기 회차를 찾을 때 쓴다. */
export async function coursesOfStudent(studentId: string): Promise<CourseRow[]> {
  const mine = await rows<{ course_id: string }>(
    db().from('lms_enrollments').select('course_id').eq('student_id', studentId),
  );
  const ids = mine.map((r) => r.course_id);
  if (ids.length === 0) return [];

  const courses = await inChunks<CourseRow>(ids, (b) =>
    db().from('lms_courses').select(COURSE_COLS).in('id', b).order('created_at', { ascending: false }).order('id'));
  return courses;
}

/**
 * 이 학생이 이 사람의 반에 있는가. 관리자는 늘 통과한다.
 *
 * 튜터가 학생 비밀번호를 재발급할 수 있게 하려면 그 학생이 정말 자기 반 학생인지를
 * 먼저 확인해야 한다. 이게 없으면 튜터가 학생 id 만 알면 남의 반 학생 비밀번호를 바꿀 수 있다.
 *
 * 대상이 학생 계정인지도 본다. 예전에는 수강 등록이 역할을 안 따져서 관리자·튜터 계정이
 * 명단에 들어갈 수 있었고, 그러면 이 문을 지나 그 계정의 비밀번호가 바뀌었다.
 */
export async function studentVisibleTo(
  studentId: string,
  user: { id: string; role: string },
): Promise<boolean> {
  if (user.role !== 'admin' && user.role !== 'tutor') return false;

  const target = await getUser(studentId);
  if (!target || target.role !== 'student') return false;
  if (user.role === 'admin') return true;

  const courses = await coursesOfStudent(studentId);
  return courses.some((c) => c.tutor_id === user.id);
}
